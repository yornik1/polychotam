import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { MarketSyncService } from "../markets/market-sync.service.js";
import { buildTopMarketsWsSelection } from "./polymarket-top-markets.js";
import { BackfillService } from "./backfill.service.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";

@Injectable()
export class PolymarketService implements OnModuleInit {
  private readonly logger = new Logger(PolymarketService.name);

  constructor(
    private readonly polymarketHttpClient: PolymarketHttpClient,
    private readonly marketSyncService: MarketSyncService,
    private readonly backfillService: BackfillService,
    private readonly polymarketWsClient: PolymarketWsClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.marketSyncService.syncSnapshot();

    const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
    const selection = buildTopMarketsWsSelection(rawMarkets, 20);

    for (const row of selection.rows) {
      try {
        await this.backfillService.deepBackfill(row.conditionId);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Неизвестная ошибка";
        this.logger.error(
          `Deep backfill не удался запустить для ${row.conditionId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Запущен deep backfill для ${selection.rows.length} рынков (очередь), подключаю live WS`,
    );
    await this.polymarketWsClient.connect(selection.assetIds);
  }
}
