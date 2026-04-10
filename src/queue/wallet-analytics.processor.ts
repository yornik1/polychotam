import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import type { WalletRecalculateJob } from "../types/contracts.js";
import { WalletsService } from "../wallets/wallets.service.js";
import {
  WALLET_ANALYTICS_JOB_RECALCULATE,
  WALLET_ANALYTICS_QUEUE_NAME,
} from "./trades-queue.config.js";

@Processor(WALLET_ANALYTICS_QUEUE_NAME)
export class WalletAnalyticsProcessor extends WorkerHost {
  constructor(private readonly walletsService: WalletsService) {
    super();
  }

  async process(job: Job<WalletRecalculateJob>): Promise<void> {
    if (job.name !== WALLET_ANALYTICS_JOB_RECALCULATE) {
      return;
    }

    await this.walletsService.recalculate(job.data.address);
  }
}
