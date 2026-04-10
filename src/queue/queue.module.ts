import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { BullModule } from "@nestjs/bullmq";
import { forwardRef, Module } from "@nestjs/common";
import { PolymarketEnrichmentModule } from "../polymarket/polymarket-enrichment.module.js";
import { PolymarketModule } from "../polymarket/polymarket.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { TradesModule } from "../trades/trades.module.js";
import { WalletsModule } from "../wallets/wallets.module.js";
import { QueueController } from "./queue.controller.js";
import { QueueService } from "./queue.service.js";
import { TradeEnrichmentProcessor } from "./trade-enrichment.processor.js";
import { TradesProcessor } from "./trades.processor.js";
import { WalletAnalyticsProcessor } from "./wallet-analytics.processor.js";
import {
  TRADE_ENRICHMENT_QUEUE_NAME,
  TRADES_QUEUE_NAME,
  WALLET_ANALYTICS_QUEUE_NAME,
  tradeEnrichmentQueueRegisterOptions,
  tradesQueueRegisterOptions,
  walletAnalyticsQueueRegisterOptions,
} from "./trades-queue.config.js";

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
    TradesProcessor,
    WalletAnalyticsProcessor,
    TradeEnrichmentProcessor,
  ],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
