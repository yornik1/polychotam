import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import { Wallet } from "./wallet.entity.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";
import { WalletsController } from "./wallets.controller.js";
import { WalletsService } from "./wallets.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";
import { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import { PolymarketModule } from "../polymarket/polymarket.module.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Trade, Market, SmartWallet, WalletPnlSnapshot]),
    PolymarketModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService, SmartWalletsService, WalletPnlV2Service],
  exports: [WalletsService, SmartWalletsService, WalletPnlV2Service],
})
export class WalletsModule {}
