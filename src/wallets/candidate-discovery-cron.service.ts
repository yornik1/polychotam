import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { CandidateDiscoveryJob } from "../types/contracts.js";
import {
  WALLET_ANALYTICS_JOB_CANDIDATE_DISCOVERY,
  WALLET_ANALYTICS_QUEUE_NAME,
  tradesDerivedJobId,
} from "../queue/trades-queue.config.js";

/**
 * Крон фонового краулинга кандидатов + промоушена discovered.
 * Раз в 6 часов ставит один агрегированный job в очередь wallet-analytics.
 */
@Injectable()
export class CandidateDiscoveryCronService {
  private readonly logger = new Logger(CandidateDiscoveryCronService.name);

  constructor(
    @InjectQueue(WALLET_ANALYTICS_QUEUE_NAME)
    private readonly walletAnalyticsQueue: Queue<CandidateDiscoveryJob>,
  ) {}

  /** Каждые 6 часов: ставит job краулинга+промоушена кандидатов. */
  @Cron("0 15 */6 * * *")
  async enqueueDiscoveryJob(): Promise<void> {
    try {
      const jobId = tradesDerivedJobId(
        "candidate-discovery",
        new Date().toISOString().slice(0, 13),
      );
      await this.walletAnalyticsQueue.add(
        WALLET_ANALYTICS_JOB_CANDIDATE_DISCOVERY,
        {},
        { jobId },
      );
      this.logger.log("Крон дискавери: поставлен job candidate-discovery");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.warn(`Крон дискавери: ${message}`);
    }
  }
}
