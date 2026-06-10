import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { SmartScoreRecalcJob } from "../types/contracts.js";
import {
  WALLET_ANALYTICS_QUEUE_NAME,
  tradesDerivedJobId,
} from "../queue/trades-queue.config.js";

/** Имя job пересчёта скоринга в очереди wallet-analytics */
export const WALLET_ANALYTICS_JOB_SMART_SCORE_RECALC = "smart-score-recalc";

/**
 * Ежедневный крон пересчёта скоринга кошельков.
 * Ставит один агрегированный job в очередь wallet-analytics.
 */
@Injectable()
export class WalletScoreCronService {
  private readonly logger = new Logger(WalletScoreCronService.name);

  constructor(
    @InjectQueue(WALLET_ANALYTICS_QUEUE_NAME)
    private readonly walletAnalyticsQueue: Queue<SmartScoreRecalcJob>,
  ) {}

  /** Раз в сутки: ставит job пересчёта скоринга кошельков. */
  @Cron("0 0 2 * * *")
  async enqueueScoreRecalcJob(): Promise<void> {
    try {
      // jobId без двоеточий — BullMQ запрещает `:` в jobId
      const jobId = tradesDerivedJobId("smart-score-recalc", new Date().toISOString().slice(0, 10));
      await this.walletAnalyticsQueue.add(
        WALLET_ANALYTICS_JOB_SMART_SCORE_RECALC,
        {},
        { jobId },
      );
      this.logger.log("Крон скоринга: поставлен job smart-score-recalc");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.warn(`Крон скоринга: ${message}`);
    }
  }
}
