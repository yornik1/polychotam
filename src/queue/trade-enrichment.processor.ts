import { Job } from "bullmq";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { LiveTradeEnricherService } from "../polymarket/live-trade-enricher.service.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { TradesService } from "../trades/trades.service.js";
import type { TradeEnrichmentJob } from "../types/contracts.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
} from "./trades-queue.config.js";

@Processor(TRADE_ENRICHMENT_QUEUE_NAME)
export class TradeEnrichmentProcessor extends WorkerHost {
  constructor(
    private readonly liveTradeEnricherService: LiveTradeEnricherService,
    private readonly tradesService: TradesService,
    private readonly tradeAlertService: TradeAlertService,
  ) {
    super();
  }

  async process(job: Job<TradeEnrichmentJob>): Promise<void> {
    if (job.name !== TRADE_ENRICHMENT_JOB_PROCESS) {
      return;
    }

    const makerAddress = await this.liveTradeEnricherService.findMakerAddress(job.data);
    if (makerAddress === null) {
      throw new Error("Trade enrichment did not find maker address");
    }

    await this.tradesService.updateMakerAddress(job.data.tradeRecordId, makerAddress);
    await this.tradeAlertService.maybeSendTradeAlert({
      address: makerAddress,
      market: job.data.market,
      side: job.data.side,
      amount: job.data.amount,
    });
  }
}
