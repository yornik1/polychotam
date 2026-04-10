import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { buildTopMarketsWsSelection } from "./polymarket-top-markets.js";
import { BackfillService } from "./backfill.service.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";

@Injectable()
export class PolymarketService implements OnModuleInit {
  private readonly logger = new Logger(PolymarketService.name);

  constructor(
    private readonly polymarketHttpClient: PolymarketHttpClient,
    private readonly backfillService: BackfillService,
    private readonly polymarketWsClient: PolymarketWsClient,
  ) {}

  async onModuleInit(): Promise<void> {
    const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
    const selection = buildTopMarketsWsSelection(rawMarkets, 20);

    for (const row of selection.rows) {
      try {
        await this.backfillService.backfill(row.conditionId, 500);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Неизвестная ошибка";
        this.logger.error(
          `Historical backfill не удался для ${row.conditionId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Historical backfill завершён для ${selection.rows.length} рынков, запускаю live WS`,
    );
    await this.polymarketWsClient.connect(selection.assetIds);
  }
}
