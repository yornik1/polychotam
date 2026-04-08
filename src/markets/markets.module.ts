import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PolymarketModule } from "../polymarket/polymarket.module.js";
import { Market } from "./market.entity.js";
import { MarketsController } from "./markets.controller.js";
import { MarketsService } from "./markets.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Market]), PolymarketModule],
  controllers: [MarketsController],
  providers: [MarketsService],
  exports: [MarketsService]
})
export class MarketsModule {}
