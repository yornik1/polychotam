import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Market } from "../markets/market.entity.js";
import { PolymarketEnrichmentModule } from "../polymarket/polymarket-enrichment.module.js";
import { Trade } from "./trade.entity.js";
import { TradesController } from "./trades.controller.js";
import { UnknownTradeRepairService } from "./unknown-trade-repair.service.js";
import { TradesService } from "./trades.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Trade, Market]), PolymarketEnrichmentModule],
  controllers: [TradesController],
  providers: [TradesService, UnknownTradeRepairService],
  exports: [TradesService, UnknownTradeRepairService],
})
export class TradesModule {}
