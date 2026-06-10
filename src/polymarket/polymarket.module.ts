import { TypeOrmModule } from "@nestjs/typeorm";
import { Module } from "@nestjs/common";
import { Market } from "../markets/market.entity.js";
import { MarketSyncService } from "../markets/market-sync.service.js";
import { Trade } from "../trades/trade.entity.js";
import { BackfillService } from "./backfill.service.js";
import { GammaMarketCronService } from "./polymarket-gamma-cron.service.js";
import { PolymarketEnrichmentModule } from "./polymarket-enrichment.module.js";
import { PolymarketMarketResolutionService } from "./polymarket-market-resolution.service.js";
import { PolymarketController } from "./polymarket.controller.js";
import { PolymarketGateway } from "./polymarket.gateway.js";
import { DataApiClient } from "./data-api.client.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketService } from "./polymarket.service.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";
import { PolymarketWsStatusService } from "./polymarket-ws-status.service.js";
import { WsConnectionEvent } from "./ws-connection-event.entity.js";
import { WsUptimeService } from "./ws-uptime.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Market, Trade, WsConnectionEvent]),
    PolymarketEnrichmentModule,
  ],
  controllers: [PolymarketController],
  providers: [
    DataApiClient,
    PolymarketService,
    PolymarketGateway,
    PolymarketHttpClient,
    MarketSyncService,
    BackfillService,
    PolymarketWsClient,
    PolymarketWsStatusService,
    WsUptimeService,
    PolymarketMarketResolutionService,
    GammaMarketCronService,
  ],
  exports: [
    DataApiClient,
    PolymarketService,
    PolymarketHttpClient,
    MarketSyncService,
    BackfillService,
    PolymarketWsClient,
    PolymarketWsStatusService,
    WsUptimeService,
    PolymarketEnrichmentModule,
    PolymarketMarketResolutionService,
  ],
})
export class PolymarketModule {}
