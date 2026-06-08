import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PolymarketModule } from "../polymarket/polymarket.module.js";
import { Market } from "./market.entity.js";
import { MarketScoreService } from "./market-score.service.js";
import { MarketsController } from "./markets.controller.js";
import { MarketsService } from "./markets.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Market]), forwardRef(() => PolymarketModule)],
  controllers: [MarketsController],
  providers: [MarketsService, MarketScoreService],
  exports: [MarketsService, MarketScoreService]
})
export class MarketsModule {}
