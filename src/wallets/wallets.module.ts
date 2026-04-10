import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Wallet } from "./wallet.entity.js";
import { WalletsController } from "./wallets.controller.js";
import { WalletsService } from "./wallets.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, Trade])],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService]
})
export class WalletsModule {}
