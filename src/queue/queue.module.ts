import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { TradesModule } from "../trades/trades.module.js";
import { WalletsModule } from "../wallets/wallets.module.js";
import { QueueController } from "./queue.controller.js";
import { QueueService } from "./queue.service.js";
import { TradesProcessor } from "./trades.processor.js";
import { WalletAnalyticsProcessor } from "./wallet-analytics.processor.js";
import {
  TRADES_QUEUE_NAME,
  WALLET_ANALYTICS_QUEUE_NAME,
  tradesQueueRegisterOptions,
  walletAnalyticsQueueRegisterOptions,
} from "./trades-queue.config.js";

@Module({
  imports: [
    BullModule.registerQueue(
      { ...tradesQueueRegisterOptions },
      { ...walletAnalyticsQueueRegisterOptions },
    ),
    BullBoardModule.forFeature({
      name: TRADES_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: WALLET_ANALYTICS_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    TradesModule,
    WalletsModule,
  ],
  controllers: [QueueController],
  providers: [QueueService, TradesProcessor, WalletAnalyticsProcessor],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
