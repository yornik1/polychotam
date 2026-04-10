import { TypeOrmModule } from "@nestjs/typeorm";
import { forwardRef, Module } from "@nestjs/common";
import { Market } from "../markets/market.entity.js";
import { MarketSyncService } from "../markets/market-sync.service.js";
import { QueueModule } from "../queue/queue.module.js";
import { BackfillService } from "./backfill.service.js";
import { PolymarketEnrichmentModule } from "./polymarket-enrichment.module.js";
import { PolymarketController } from "./polymarket.controller.js";
import { PolymarketGateway } from "./polymarket.gateway.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketService } from "./polymarket.service.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";

@Module({
  imports: [
    forwardRef(() => QueueModule),
    TypeOrmModule.forFeature([Market]),
    PolymarketEnrichmentModule,
  ],
  controllers: [PolymarketController],
  providers: [
    PolymarketService,
    PolymarketGateway,
    PolymarketHttpClient,
    MarketSyncService,
    BackfillService,
    PolymarketWsClient,
  ],
  exports: [
    PolymarketService,
    PolymarketHttpClient,
    MarketSyncService,
    BackfillService,
    PolymarketWsClient,
    PolymarketEnrichmentModule,
  ],
})
export class PolymarketModule {}
