import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PolymarketHttpClient } from "../polymarket/polymarket-http.client.js";
import {
  PolymarketSimplifiedMarketRaw,
  PolymarketSimplifiedTokenRaw,
} from "../polymarket/dto/polymarket-simplified-market.raw.js";
import { Market } from "./market.entity.js";

@Injectable()
export class MarketSyncService {
  constructor(
    @Inject(PolymarketHttpClient)
    private readonly polymarketHttpClient: Pick<
      PolymarketHttpClient,
      "fetchMarkets" | "fetchSimplifiedMarkets"
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
    await this.marketRepository.upsert(
      markets.map((market) => {
        const conditionId = this.normalizeString(market.condition_id);
        const resolvedToken = this.resolveWinningToken(simplifiedByConditionId.get(conditionId));

        return {
          condition_id: conditionId,
          question: this.normalizeString(market.question),
          market_slug: this.normalizeString(market.market_slug),
          tokens: Array.isArray(market.tokens) ? market.tokens : [],
          winning_token_id: resolvedToken?.token_id ?? null,
          winning_outcome: resolvedToken?.outcome ?? null,
          active: this.normalizeBoolean(market.active),
          closed: this.normalizeBoolean(market.closed),
          accepting_orders: this.normalizeNullableBoolean(market.accepting_orders),
          liquidity: this.normalizeNumber(market.liquidity),
          volume24hr: this.normalizeNumber(market.volume24hr),
          end_date_iso: this.normalizeNullableString(market.end_date_iso),
          internal_synced_at: syncedAt,
        } satisfies Partial<Market>;
      }),
      ["condition_id"],
    );
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
}
