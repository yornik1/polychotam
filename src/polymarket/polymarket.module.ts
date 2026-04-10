import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module.js";
import { PolymarketController } from "./polymarket.controller.js";
import { PolymarketGateway } from "./polymarket.gateway.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketService } from "./polymarket.service.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";

@Module({
  imports: [QueueModule],
  controllers: [PolymarketController],
  providers: [
    PolymarketService,
    PolymarketGateway,
    PolymarketHttpClient,
    PolymarketWsClient,
  ],
  exports: [PolymarketService, PolymarketHttpClient, PolymarketWsClient],
})
export class PolymarketModule {}
