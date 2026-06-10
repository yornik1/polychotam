import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import type { WalletPnlRecalcJob } from "../types/contracts.js";
import {
  tradesDerivedJobId,
  WALLET_ANALYTICS_JOB_PNL_RECALC,
  WALLET_ANALYTICS_QUEUE_NAME,
} from "./trades-queue.config.js";

/** Префикс jobId для on-demand PnL-пересчёта (не коллизирует с wallet-recalculate). */
const PNL_RECALC_JOB_ID_PREFIX = "pnl";

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(WALLET_ANALYTICS_QUEUE_NAME)
    private readonly walletAnalyticsQueue: Queue<WalletPnlRecalcJob>,
  ) {}

  /**
   * Ставит job пересчёта PnL v2 для заданного адреса.
   * jobId детерминирован от адреса → повторные вызовы для того же адреса
   * коалесцируются BullMQ (pending-джоб не дублируется).
   */
  async enqueueWalletPnlRecalc(address: string): Promise<void> {
    const jobId = tradesDerivedJobId(PNL_RECALC_JOB_ID_PREFIX, address);
    await this.walletAnalyticsQueue.add(
      WALLET_ANALYTICS_JOB_PNL_RECALC,
      { address },
      { jobId },
    );
  }
}
