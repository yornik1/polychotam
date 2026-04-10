import { BullBoardModule } from "@bull-board/nestjs";
import { ExpressAdapter } from "@bull-board/express";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { buildBullMqConfig } from "./config/bullmq.config.js";
import { ENV_FILE_PATHS } from "./config/env-files.js";
import { buildTypeOrmConfig } from "./config/typeorm.config.js";
import { CommonModule } from "./common/common.module.js";
import { MarketsModule } from "./markets/markets.module.js";
import { PolymarketModule } from "./polymarket/polymarket.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { TelegramModule } from "./telegram/telegram.module.js";
import { TradesModule } from "./trades/trades.module.js";
import { WalletsModule } from "./wallets/wallets.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [...ENV_FILE_PATHS],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildTypeOrmConfig(configService),
    }),
    BullBoardModule.forRoot({
      route: "/queues",
      adapter: ExpressAdapter,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildBullMqConfig(configService),
    }),
    MarketsModule,
    TradesModule,
    WalletsModule,
    QueueModule,
    PolymarketModule,
    TelegramModule,
    CommonModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
