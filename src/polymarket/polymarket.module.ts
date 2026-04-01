import { Module } from "@nestjs/common";
import { PolymarketController } from "./polymarket.controller.js";
import { PolymarketGateway } from "./polymarket.gateway.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketService } from "./polymarket.service.js";

@Module({
  controllers: [PolymarketController],
  providers: [PolymarketService, PolymarketGateway, PolymarketHttpClient],
  exports: [PolymarketService, PolymarketHttpClient]
})
export class PolymarketModule {}
