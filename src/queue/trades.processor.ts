import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job, Queue } from "bullmq";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import type { TradeEnrichmentJob, WalletRecalculateJob } from "../types/contracts.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { TradesService } from "../trades/trades.service.js";
import { buildWsTradeRecordId } from "../trades/trade-id.util.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
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
    @InjectQueue(TRADE_ENRICHMENT_QUEUE_NAME)
    private readonly tradeEnrichmentQueue: Queue<TradeEnrichmentJob>,
    private readonly tradeAlertService: TradeAlertService,
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
      await this.tradeAlertService.maybeSendTradeAlert({
        address,
        market: job.data.market,
        side: job.data.side,
        amount: job.data.amount,
      });
      return;
    }

    const tradeRecordId = buildWsTradeRecordId(job.data);
    await this.tradeEnrichmentQueue.add(
      TRADE_ENRICHMENT_JOB_PROCESS,
      {
        tradeRecordId,
        market: job.data.market,
        assetId: job.data.assetId,
        side: job.data.side,
        amount: job.data.amount,
        price: job.data.price,
        timestamp: job.data.timestamp,
      },
      { jobId: `trade-enrichment:${tradeRecordId}` },
    );
  }

  /**
   * Выравниваем fallback с тем, как historical trade пишет `maker_address` в БД:
   * makerAddress -> wallet -> owner.
   */
  private resolveWalletAddress(event: TradeEvent): string | null {
    const makerAddress = event.makerAddress?.trim();
    if (makerAddress !== undefined && makerAddress.length > 0) {
      return makerAddress;
    }

    const wallet = event.wallet.trim();
    if (wallet.length > 0) {
      return wallet;
    }

    const owner = event.owner?.trim();
    if (owner !== undefined && owner.length > 0) {
      return owner;
    }
    return null;
  }
}
