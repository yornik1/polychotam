import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { BullModule } from "@nestjs/bullmq";
import { forwardRef, Global, Module } from "@nestjs/common";
import { PolymarketEnrichmentModule } from "../polymarket/polymarket-enrichment.module.js";
import { PolymarketModule } from "../polymarket/polymarket.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { TradesModule } from "../trades/trades.module.js";
import { WalletsModule } from "../wallets/wallets.module.js";
import { BullJobErrorLogListener } from "./bull-job-error-log.listener.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import { QueueController } from "./queue.controller.js";
import { QueueService } from "./queue.service.js";
import { QueueStatsService } from "./queue-stats.service.js";
import { TradeEnrichmentProcessor } from "./trade-enrichment.processor.js";
import { TradesProcessor } from "./trades.processor.js";
import { UnknownTradeBackfillFeederService } from "./unknown-trade-backfill-feeder.service.js";
import { WalletAnalyticsProcessor } from "./wallet-analytics.processor.js";
import {
  TRADE_ENRICHMENT_QUEUE_NAME,
  TRADES_QUEUE_NAME,
  WALLET_ANALYTICS_QUEUE_NAME,
  tradeEnrichmentQueueRegisterOptions,
  tradesQueueRegisterOptions,
  walletAnalyticsQueueRegisterOptions,
} from "./trades-queue.config.js";

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { ...tradesQueueRegisterOptions },
      { ...walletAnalyticsQueueRegisterOptions },
      { ...tradeEnrichmentQueueRegisterOptions },
    ),
    BullBoardModule.forFeature({
      name: TRADES_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: WALLET_ANALYTICS_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: TRADE_ENRICHMENT_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    TradesModule,
    WalletsModule,
    PolymarketEnrichmentModule,
    forwardRef(() => PolymarketModule),
    forwardRef(() => TelegramModule),
  ],
  controllers: [QueueController],
  providers: [
    QueueService,
    QueueStatsService,
    BullJobNdjsonLogService,
    BullJobErrorLogListener,
    TradesProcessor,
    WalletAnalyticsProcessor,
    TradeEnrichmentProcessor,
    UnknownTradeBackfillFeederService,
  ],
  exports: [BullModule, QueueService, QueueStatsService, BullJobNdjsonLogService],
})
export class QueueModule {}
