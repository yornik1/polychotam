import { Module } from "@nestjs/common";
import { PolymarketController } from "./polymarket.controller.js";
import { PolymarketGateway } from "./polymarket.gateway.js";
import { PolymarketService } from "./polymarket.service.js";

@Module({
  controllers: [PolymarketController],
  providers: [PolymarketService, PolymarketGateway],
  exports: [PolymarketService]
})
export class PolymarketModule {}
