import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import { Wallet } from "./wallet.entity.js";
import { WalletsController } from "./wallets.controller.js";
import { WalletsService } from "./wallets.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, Trade, Market, SmartWallet])],
  controllers: [WalletsController],
  providers: [WalletsService, SmartWalletsService],
  exports: [WalletsService, SmartWalletsService],
})
export class WalletsModule {}
