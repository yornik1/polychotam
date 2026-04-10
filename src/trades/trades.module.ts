import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Market } from "../markets/market.entity.js";
import { Trade } from "./trade.entity.js";
import { TradesController } from "./trades.controller.js";
import { TradesService } from "./trades.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Trade, Market])],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService]
})
export class TradesModule {}
