import { Module } from "@nestjs/common";
import { LiveTradeEnricherService } from "./live-trade-enricher.service.js";

@Module({
  providers: [LiveTradeEnricherService],
  exports: [LiveTradeEnricherService],
})
export class PolymarketEnrichmentModule {}
