import { Module } from "@nestjs/common";
import { PolymarketModule } from "../polymarket/polymarket.module.js";
import { MarketsController } from "./markets.controller.js";
import { MarketsService } from "./markets.service.js";

@Module({
  imports: [PolymarketModule],
  controllers: [MarketsController],
  providers: [MarketsService],
  exports: [MarketsService]
})
export class MarketsModule {}
