import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MarketSyncService } from "../markets/market-sync.service.js";
import { buildTopMarketsWsSelectionFromGamma } from "./polymarket-gamma-top-markets.js";
import { buildTopMarketsWsSelection } from "./polymarket-top-markets.js";
import type { TopMarketsWsSelection } from "./polymarket-top-markets.js";
import { BackfillService } from "./backfill.service.js";
import type { GammaMarketRaw } from "./dto/gamma-market.raw.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";

@Injectable()
export class PolymarketService implements OnModuleInit {
  private readonly logger = new Logger(PolymarketService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly polymarketHttpClient: PolymarketHttpClient,
    private readonly marketSyncService: MarketSyncService,
    private readonly backfillService: BackfillService,
    private readonly polymarketWsClient: PolymarketWsClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.marketSyncService.syncSnapshot();

    const limit = this.resolveTopMarketsLimit();
    const selection = await this.resolveTopMarketsWsSelection(limit);
    if (selection.gammaSource.length > 0) {
      await this.marketSyncService.upsertGammaMarketsAndCollectNewlyResolved(
        selection.gammaSource,
      );
    }

    await this.polymarketWsClient.connect(selection.assetIds);

    for (const row of selection.rows) {
      try {
        await this.backfillService.deepBackfill(row.conditionId);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Неизвестная ошибка";
        this.logger.error(
          `Deep backfill не удался запустить для ${row.conditionId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Live WS подключён; deep backfill поставлен в очередь для ${selection.rows.length} рынков`,
    );
  }

  /**
   * Лимит топ-маркетов для WS-подписки. Дефолт 20.
   * Polymarket CLOB market channel позволяет подписаться на много assets_ids,
   * но больше = больше нагрузки и риск rate limit.
   */
  private resolveTopMarketsLimit(): number {
    const raw = this.configService.get<string>("POLYMARKET_TOP_MARKETS_LIMIT");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 20;
    }
    return Math.min(Math.floor(parsed), 200);
  }

  private async resolveTopMarketsWsSelection(
    limit: number,
  ): Promise<TopMarketsWsSelection & { gammaSource: GammaMarketRaw[] }> {
    try {
      const gammaMarkets =
        await this.polymarketHttpClient.fetchActiveMarketsFromGamma(limit);
      const selection = buildTopMarketsWsSelectionFromGamma(gammaMarkets, limit);
      return { ...selection, gammaSource: [...gammaMarkets] };
    } catch (errorGamma: unknown) {
      const msg =
        errorGamma instanceof Error ? errorGamma.message : "Неизвестная ошибка";
      this.logger.warn(
        `Gamma API недоступен (${msg}), fallback топ-маркетов на CLOB /markets`,
      );
      const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
      const selection = buildTopMarketsWsSelection(rawMarkets, limit);
      return { ...selection, gammaSource: [] };
    }
  }
}
