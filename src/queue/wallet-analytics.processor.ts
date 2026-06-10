import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import type { SmartScoreRecalcJob, WalletPnlRecalcJob, WalletRecalculateJob } from "../types/contracts.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { WalletPnlV2Service } from "../wallets/wallet-pnl-v2.service.js";
import { LbCrossCheckService } from "../wallets/lb-cross-check.service.js";
import { WalletScoreService } from "../wallets/wallet-score.service.js";
import { WALLET_ANALYTICS_JOB_SMART_SCORE_RECALC } from "../wallets/wallet-score-cron.service.js";
import {
  WALLET_ANALYTICS_JOB_PNL_RECALC,
  WALLET_ANALYTICS_JOB_RECALCULATE,
  WALLET_ANALYTICS_QUEUE_NAME,
  WALLET_ANALYTICS_WORKER_OPTIONS,
} from "./trades-queue.config.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";

@Processor(WALLET_ANALYTICS_QUEUE_NAME, WALLET_ANALYTICS_WORKER_OPTIONS)
export class WalletAnalyticsProcessor extends WorkerHost {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly walletPnlV2Service: WalletPnlV2Service,
    private readonly lbCrossCheckService: LbCrossCheckService,
    private readonly walletScoreService: WalletScoreService,
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

  async process(job: Job<WalletRecalculateJob | WalletPnlRecalcJob | SmartScoreRecalcJob>): Promise<void> {
    // Существующий guard: обработка wallet-recalculate
    if (job.name === WALLET_ANALYTICS_JOB_RECALCULATE) {
      await this.walletsService.recalculate((job.data as WalletRecalculateJob).address);
      return;
    }

    // Пересчёт PnL v2 по всем окнам последовательно
    if (job.name === WALLET_ANALYTICS_JOB_PNL_RECALC) {
      const { address } = job.data as WalletPnlRecalcJob;
      await this.walletPnlV2Service.recalc(address, "all");
      await this.walletPnlV2Service.recalc(address, "90d");
      await this.walletPnlV2Service.recalc(address, "30d");
      // Кросс-валидация против lb-api сразу после пересчёта:
      // выставляет validated по сходимости на окнах all/30d (Principle #2 плана)
      await this.lbCrossCheckService.validateWallet(address);
      return;
    }

    // Ежедневный пересчёт скоринга кошельков
    if (job.name === WALLET_ANALYTICS_JOB_SMART_SCORE_RECALC) {
      await this.walletScoreService.recalcScores();
      return;
    }
  }
}
