import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TelegrafModule } from "nestjs-telegraf";
import { MarketsModule } from "../markets/markets.module.js";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { WalletsModule } from "../wallets/wallets.module.js";
import { TelegramController } from "./telegram.controller.js";
import { TradeAlertService } from "./trade-alert.service.js";
import { TelegramUpdate } from "./telegram.update.js";
import { TelegramService } from "./telegram.service.js";

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => MarketsModule),
    WalletsModule,
    TypeOrmModule.forFeature([Trade, Market]),
    TelegrafModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        token: configService.getOrThrow<string>("TELEGRAM_BOT_TOKEN"),
      }),
    }),
  ],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramUpdate, TradeAlertService],
  exports: [TelegramService, TradeAlertService],
})
export class TelegramModule {}
