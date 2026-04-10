import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job, Queue } from "bullmq";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import type { WalletRecalculateJob } from "../types/contracts.js";
import { TradesService } from "../trades/trades.service.js";
import {
  TRADES_JOB_PROCESS,
  TRADES_QUEUE_NAME,
  WALLET_ANALYTICS_JOB_RECALCULATE,
  WALLET_ANALYTICS_QUEUE_NAME,
} from "./trades-queue.config.js";

@Processor(TRADES_QUEUE_NAME)
export class TradesProcessor extends WorkerHost {
  constructor(
    private readonly tradesService: TradesService,
    @InjectQueue(WALLET_ANALYTICS_QUEUE_NAME)
    private readonly walletAnalyticsQueue: Queue<WalletRecalculateJob>,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<TradeEvent>): Promise<void> {
    if (job.name !== TRADES_JOB_PROCESS) {
      return;
    }

    if (this.configService.get<string>("TRADES_PROCESSOR_THROW") === "true") {
      throw new Error(
        "TRADES_PROCESSOR_THROW=true: проверка retry и failed в Bull Board",
      );
    }

    await this.tradesService.saveFromWsTradeEvent(job.data);

    const address = this.resolveWalletAddress(job.data);
    if (address !== null) {
      await this.walletAnalyticsQueue.add(
        WALLET_ANALYTICS_JOB_RECALCULATE,
        { address },
        { jobId: `wallet-recalculate:${address}` },
      );
    }
  }

  private resolveWalletAddress(event: TradeEvent): string | null {
    const makerAddress = event.makerAddress?.trim();
    if (makerAddress !== undefined && makerAddress.length > 0) {
      return makerAddress;
    }

    const owner = event.owner?.trim();
    if (owner !== undefined && owner.length > 0) {
      return owner;
    }

    const wallet = event.wallet.trim();
    return wallet.length > 0 ? wallet : null;
  }
}
