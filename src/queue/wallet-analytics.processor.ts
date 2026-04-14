import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import type { WalletRecalculateJob } from "../types/contracts.js";
import { WalletsService } from "../wallets/wallets.service.js";
import {
  WALLET_ANALYTICS_JOB_RECALCULATE,
  WALLET_ANALYTICS_QUEUE_NAME,
  WALLET_ANALYTICS_WORKER_OPTIONS,
} from "./trades-queue.config.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";

@Processor(WALLET_ANALYTICS_QUEUE_NAME, WALLET_ANALYTICS_WORKER_OPTIONS)
export class WalletAnalyticsProcessor extends WorkerHost {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly bullNdjsonLog: BullJobNdjsonLogService,
  ) {
    super();
  }

  @OnWorkerEvent("failed")
  onWorkerFailed(
    job: Job<WalletRecalculateJob> | undefined,
    error: Error,
    prev: string,
  ): void {
    this.bullNdjsonLog.logWorkerFailed(
      WALLET_ANALYTICS_QUEUE_NAME,
      job,
      error,
      prev,
    );
  }

  async process(job: Job<WalletRecalculateJob>): Promise<void> {
    if (job.name !== WALLET_ANALYTICS_JOB_RECALCULATE) {
      return;
    }

    await this.walletsService.recalculate(job.data.address);
  }
}
