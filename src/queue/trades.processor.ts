import { forwardRef, Inject } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job, Queue } from "bullmq";
import { BackfillService } from "../polymarket/backfill.service.js";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import type {
  TradeEnrichmentJob,
  TradesBackfillPageJob,
  WalletRecalculateJob,
} from "../types/contracts.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { TradesService } from "../trades/trades.service.js";
import { buildWsTradeRecordId } from "../trades/trade-id.util.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
  TRADES_JOB_BACKFILL_PAGE,
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
    @Inject(forwardRef(() => BackfillService))
    private readonly backfillService: BackfillService,
  ) {
    super();
  }

  async process(job: Job<TradeEvent | TradesBackfillPageJob>): Promise<void> {
    if (job.name === TRADES_JOB_BACKFILL_PAGE) {
      const payload = job.data as TradesBackfillPageJob;
      await this.backfillService.processBackfillPage(
        payload.conditionId,
        payload.offset,
      );
      return;
    }

    if (job.name !== TRADES_JOB_PROCESS) {
      return;
    }

    const event = job.data as TradeEvent;

    if (this.configService.get<string>("TRADES_PROCESSOR_THROW") === "true") {
      throw new Error(
        "TRADES_PROCESSOR_THROW=true: проверка retry и failed в Bull Board",
      );
    }

    await this.tradesService.saveFromWsTradeEvent(event);

    const address = this.resolveWalletAddress(event);
    if (address !== null) {
      await this.walletAnalyticsQueue.add(
        WALLET_ANALYTICS_JOB_RECALCULATE,
        { address },
        { jobId: `wallet-recalculate:${address}` },
      );
      await this.tradeAlertService.maybeSendTradeAlert({
        address,
        market: event.market,
        side: event.side,
        amount: event.amount,
      });
      return;
    }

    const tradeRecordId = buildWsTradeRecordId(event);
    await this.tradeEnrichmentQueue.add(
      TRADE_ENRICHMENT_JOB_PROCESS,
      {
        tradeRecordId,
        market: event.market,
        assetId: event.assetId,
        side: event.side,
        amount: event.amount,
        price: event.price,
        timestamp: event.timestamp,
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
