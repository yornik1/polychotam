import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import type { GammaMarketRaw } from "../polymarket/dto/gamma-market.raw.js";
import { PolymarketHttpClient } from "../polymarket/polymarket-http.client.js";
import {
  PolymarketSimplifiedMarketRaw,
  PolymarketSimplifiedTokenRaw,
} from "../polymarket/dto/polymarket-simplified-market.raw.js";
import {
  buildTokensJsonFromGamma,
  deriveWinningTokenIdFromGamma,
  gammaConditionId,
  gammaLiquidityNum,
  gammaVolume24hr,
  gammaWinningOutcome,
} from "../polymarket/polymarket-gamma.util.js";
import { mapGammaCategory } from "./market-category.util.js";
import { Market } from "./market.entity.js";

type MarketSnapshotRow = {
  condition_id: string;
  question: string;
  market_slug: string;
  tokens: Record<string, unknown>[];
  winning_token_id: string | null;
  winning_outcome: string | null;
  active: boolean;
  closed: boolean;
  accepting_orders: boolean | null;
  liquidity: number;
  volume24hr: number;
  end_date_iso: string | null;
  /** Опциональна: CLOB-путь не знает категорию и не должен затирать значение из Gamma при upsert. */
  category?: string | null;
  internal_synced_at: Date;
};

@Injectable()
export class MarketSyncService {
  constructor(
    @Inject(PolymarketHttpClient)
    private readonly polymarketHttpClient: Pick<
      PolymarketHttpClient,
      "fetchMarkets" | "fetchSimplifiedMarkets" | "fetchClosedMarketsGammaKeysetPage"
    >,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
  ) {}

  async syncSnapshot(): Promise<void> {
    const [markets, simplifiedMarkets] = await Promise.all([
      this.polymarketHttpClient.fetchMarkets(),
      this.polymarketHttpClient.fetchSimplifiedMarkets(),
    ]);

    const simplifiedByConditionId = new Map(
      simplifiedMarkets.map((market) => [this.normalizeString(market.condition_id), market]),
    );

    const syncedAt = new Date();
    const deduplicatedMarkets = new Map<string, MarketSnapshotRow>();

    for (const market of markets) {
        const conditionId = this.normalizeString(market.condition_id);
        const resolvedToken = this.resolveWinningToken(simplifiedByConditionId.get(conditionId));

        deduplicatedMarkets.set(conditionId, {
          condition_id: conditionId,
          question: this.normalizeString(market.question),
          market_slug: this.normalizeString(market.market_slug),
          tokens: this.normalizeTokens(market.tokens),
          winning_token_id: resolvedToken?.token_id ?? null,
          winning_outcome: resolvedToken?.outcome ?? null,
          active: this.normalizeBoolean(market.active),
          closed: this.normalizeBoolean(market.closed),
          accepting_orders: this.normalizeNullableBoolean(market.accepting_orders),
          liquidity: this.normalizeNumber(market.liquidity),
          volume24hr: this.normalizeNumber(market.volume24hr),
          end_date_iso: this.normalizeNullableString(market.end_date_iso),
          internal_synced_at: syncedAt,
        });
    }

    await this.marketRepository.upsert(
      [...deduplicatedMarkets.values()],
      ["condition_id"],
    );
  }

  /**
   * Upsert строк из Gamma и возвращает condition_id маркетов, у которых впервые появился
   * `winning_token_id` при `closed` (для пересчёта кошельков).
   */
  async upsertGammaMarketsAndCollectNewlyResolved(
    markets: readonly GammaMarketRaw[],
  ): Promise<readonly string[]> {
    const syncedAt = new Date();
    const rows: MarketSnapshotRow[] = [];
    for (const market of markets) {
      const row = this.mapGammaMarketToSnapshotRow(market, syncedAt);
      if (row !== null) {
        rows.push(row);
      }
    }
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((r) => r.condition_id);
    const existing = await this.marketRepository.find({
      where: { condition_id: In(ids) },
      select: ["condition_id", "closed", "winning_token_id"],
    });
    const prev = new Map(
      existing.map((e) => [
        e.condition_id,
        {
          closed: e.closed,
          winning_token_id: e.winning_token_id,
        },
      ]),
    );

    await this.marketRepository.upsert(rows, ["condition_id"]);

    const newlyResolved: string[] = [];
    for (const row of rows) {
      if (!row.closed || row.winning_token_id === null || row.winning_token_id.trim().length === 0) {
        continue;
      }
      const was = prev.get(row.condition_id);
      const hadWinner =
        was !== undefined &&
        was.winning_token_id !== null &&
        String(was.winning_token_id).trim().length > 0;
      if (!hadWinner) {
        newlyResolved.push(row.condition_id);
      }
    }
    return newlyResolved;
  }

  /**
   * Бэкфилл закрытых маркетов из Gamma `/markets/keyset` (ключевая пагинация).
   */
  async backfillClosedMarketsFromGammaKeyset(opts: {
    maxPages: number;
    pageSize: number;
  }): Promise<{ pagesProcessed: number; marketsUpserted: number; newlyResolved: string[] }> {
    const allNewlyResolved: string[] = [];
    let cursor: string | undefined;
    let pagesProcessed = 0;
    let marketsUpserted = 0;
    const maxPages =
      Number.isFinite(opts.maxPages) && opts.maxPages > 0 ? Math.floor(opts.maxPages) : 0;
    const pageSizeRaw =
      Number.isFinite(opts.pageSize) && opts.pageSize > 0
        ? Math.floor(opts.pageSize)
        : 500;

    for (let page = 0; page < maxPages; page += 1) {
      let pageResult: { markets: readonly GammaMarketRaw[]; next_cursor: string | null };
      try {
        pageResult = await this.polymarketHttpClient.fetchClosedMarketsGammaKeysetPage({
          limit: pageSizeRaw,
          afterCursor: cursor,
        });
      } catch {
        break;
      }

      const gammaMarkets = pageResult.markets;
      if (!Array.isArray(gammaMarkets) || gammaMarkets.length === 0) {
        break;
      }

      const newlyResolved = await this.upsertGammaMarketsAndCollectNewlyResolved(gammaMarkets);
      allNewlyResolved.push(...newlyResolved);
      marketsUpserted += gammaMarkets.length;
      pagesProcessed += 1;

      const nextCursor = pageResult.next_cursor;
      if (nextCursor === null || nextCursor.length === 0) {
        break;
      }
      if (gammaMarkets.length < Math.min(pageSizeRaw, 1000)) {
        break;
      }
      cursor = nextCursor;

      await new Promise((r) => setTimeout(r, 300));
    }

    return { pagesProcessed, marketsUpserted, newlyResolved: allNewlyResolved };
  }

  private mapGammaMarketToSnapshotRow(
    market: GammaMarketRaw,
    syncedAt: Date,
  ): MarketSnapshotRow | null {
    const condition_id = gammaConditionId(market);
    if (condition_id === null) {
      return null;
    }
    const tokens = buildTokensJsonFromGamma(market);
    if (tokens.length === 0) {
      return null;
    }
    const questionRaw = market.question;
    const question =
      typeof questionRaw === "string" && questionRaw.trim().length > 0
        ? questionRaw.trim()
        : `Gamma market ${condition_id.slice(0, 12)}…`;
    const slugRaw =
      typeof market.slug === "string"
        ? market.slug.trim()
        : typeof market.market_slug === "string"
          ? market.market_slug.trim()
          : "";
    const market_slug =
      slugRaw.length > 0 ? slugRaw : `gamma-${condition_id.slice(2, 18)}`;
    const closed = market.closed === true;
    const active = market.active === true;
    const winning_token_id = closed ? deriveWinningTokenIdFromGamma(market) : null;
    const winning_outcome = closed ? gammaWinningOutcome(market) : null;
    const endIso =
      typeof market.endDateIso === "string"
        ? market.endDateIso.trim() || null
        : typeof market.end_date_iso === "string"
          ? market.end_date_iso.trim() || null
          : null;

    return {
      condition_id,
      question,
      market_slug,
      tokens,
      winning_token_id,
      winning_outcome,
      active,
      closed,
      accepting_orders: active && !closed ? true : null,
      liquidity: gammaLiquidityNum(market),
      volume24hr: gammaVolume24hr(market),
      end_date_iso: endIso,
      category: mapGammaCategory(market),
      internal_synced_at: syncedAt,
    };
  }

  private resolveWinningToken(
    market: PolymarketSimplifiedMarketRaw | undefined,
  ): { token_id: string; outcome: string } | null {
    if (market === undefined || !Array.isArray(market.tokens)) {
      return null;
    }

    for (const token of market.tokens) {
      if (this.isWinningToken(token)) {
        return {
          token_id: token.token_id,
          outcome: token.outcome,
        };
      }
    }

    return null;
  }

  private isWinningToken(token: unknown): token is { token_id: string; outcome: string; winner: true } {
    if (typeof token !== "object" || token === null) {
      return false;
    }

    const rawToken = token as PolymarketSimplifiedTokenRaw;
    return (
      typeof rawToken.token_id === "string" &&
      rawToken.token_id.trim().length > 0 &&
      typeof rawToken.outcome === "string" &&
      rawToken.outcome.trim().length > 0 &&
      rawToken.winner === true
    );
  }

  private normalizeString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private normalizeNullableString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeBoolean(value: unknown): boolean {
    return value === true;
  }

  private normalizeNullableBoolean(value: unknown): boolean | null {
    if (typeof value !== "boolean") {
      return null;
    }

    return value;
  }

  private normalizeNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return 0;
  }

  private normalizeTokens(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (token): token is Record<string, unknown> =>
        typeof token === "object" && token !== null,
    );
  }
}
