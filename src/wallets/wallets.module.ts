import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import { Wallet } from "./wallet.entity.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";
import { WalletScore } from "./wallet-score.entity.js";
import { WalletsController } from "./wallets.controller.js";
import { WalletsService } from "./wallets.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";
import { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import { WalletPnlCronService } from "./wallet-pnl-cron.service.js";
import { WalletScoreService } from "./wallet-score.service.js";
import { WalletScoreCronService } from "./wallet-score-cron.service.js";
import { LbCrossCheckService } from "./lb-cross-check.service.js";
import { PolymarketModule } from "../polymarket/polymarket.module.js";
import { TelegramModule } from "../telegram/telegram.module.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Trade, Market, SmartWallet, WalletPnlSnapshot, WalletScore]),
    PolymarketModule,
    // forwardRef: TelegramModule импортирует WalletsModule → избегаем цикла
    forwardRef(() => TelegramModule),
  ],
  controllers: [WalletsController],
  providers: [WalletsService, SmartWalletsService, WalletPnlV2Service, WalletPnlCronService, WalletScoreService, WalletScoreCronService, LbCrossCheckService],
  exports: [WalletsService, SmartWalletsService, WalletPnlV2Service, WalletScoreService, LbCrossCheckService],
})
export class WalletsModule {}
