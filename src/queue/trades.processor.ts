import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { TradesService } from "../trades/trades.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { TRADES_JOB_PROCESS, TRADES_QUEUE_NAME } from "./trades-queue.config.js";

@Processor(TRADES_QUEUE_NAME)
export class TradesProcessor extends WorkerHost {
  constructor(
    private readonly tradesService: TradesService,
    private readonly walletsService: WalletsService,
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

    const wallet = job.data.wallet.trim();
    if (wallet.length > 0) {
      await this.walletsService.upsert({
        address: wallet,
        total_won: "0",
        total_lost: "0",
        win_rate: "0",
      });
    }
  }
}
