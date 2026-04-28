import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { LiveTradeEnricherService } from "../polymarket/live-trade-enricher.service.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { TradesService } from "../trades/trades.service.js";
import type { TradeEnrichmentJob } from "../types/contracts.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
  TRADE_ENRICHMENT_WORKER_OPTIONS,
} from "./trades-queue.config.js";

@Processor(TRADE_ENRICHMENT_QUEUE_NAME, TRADE_ENRICHMENT_WORKER_OPTIONS)
export class TradeEnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(TradeEnrichmentProcessor.name);

  constructor(
    private readonly liveTradeEnricherService: LiveTradeEnricherService,
    private readonly tradesService: TradesService,
    private readonly tradeAlertService: TradeAlertService,
    private readonly bullNdjsonLog: BullJobNdjsonLogService,
  ) {
    super();
  }

  @OnWorkerEvent("failed")
  onWorkerFailed(
    job: Job<TradeEnrichmentJob> | undefined,
    error: Error,
    prev: string,
  ): void {
    const maxAttempts = job?.opts?.attempts ?? 3;
    // Промежуточный ретрай — BullMQ сам перезапустит, логировать не нужно
    if (
      job !== undefined &&
      (job.attemptsMade ?? 0) < maxAttempts
    ) {
      return;
    }
    this.bullNdjsonLog.logWorkerFailed(
      TRADE_ENRICHMENT_QUEUE_NAME,
      job,
      error,
      prev,
    );
  }

  async process(job: Job<TradeEnrichmentJob>): Promise<void> {
    if (job.name !== TRADE_ENRICHMENT_JOB_PROCESS) {
      return;
    }

    const makerAddress = await this.liveTradeEnricherService.findMakerAddress(job.data);
    if (makerAddress === null) {
      const maxAttempts = job.opts?.attempts ?? 3;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.logger.warn(
          `Enrichment не нашёл maker address для ${job.data.tradeRecordId} после ${job.attemptsMade + 1} попыток, пропускаю`,
        );
        const msg =
          "Trade enrichment did not find maker address (исчерпаны попытки, джоб завершён без throw)";
        this.bullNdjsonLog.append({
          eventType: "enrichment_maker_not_found_final",
          source: "TradeEnrichmentProcessor",
          queue: TRADE_ENRICHMENT_QUEUE_NAME,
          jobId: job.id,
          jobName: job.name,
          message: msg,
          failedReason: msg,
          attemptsMade: job.attemptsMade + 1,
          maxAttempts,
          data: job.data,
          oneLine: `[${TRADE_ENRICHMENT_QUEUE_NAME}] ${job.name} id=${job.id}: ${msg}`,
        });
        return;
      }
      throw new Error("Trade enrichment did not find maker address");
    }

    await this.tradesService.updateMakerAddress(job.data.tradeRecordId, makerAddress);
    await this.tradeAlertService.maybeSendTradeAlert({
      address: makerAddress,
      market: job.data.market,
      side: job.data.side,
      amount: job.data.amount,
      tradeTimestamp: job.data.timestamp,
    });
  }
}
