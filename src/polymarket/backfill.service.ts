import { createHash } from "node:crypto";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import type {
  TradeEvent,
  TradeSide,
  TradeTraderSide,
} from "./dto/trade-event.js";
import {
  TRADES_JOB_PROCESS,
  TRADES_QUEUE_NAME,
} from "../queue/trades-queue.config.js";

const DEFAULT_BACKFILL_LIMIT = 500;
const DEFAULT_POLYMARKET_DATA_API_URL = "https://data-api.polymarket.com";

interface HistoricalTradeRaw {
  readonly id?: unknown;
  readonly taker_order_id?: unknown;
  readonly market?: unknown;
  readonly asset_id?: unknown;
  readonly side?: unknown;
  readonly size?: unknown;
  readonly fee_rate_bps?: unknown;
  readonly price?: unknown;
  readonly status?: unknown;
  readonly match_time?: unknown;
  readonly outcome?: unknown;
  readonly bucket_index?: unknown;
  readonly owner?: unknown;
  readonly maker_address?: unknown;
  readonly transaction_hash?: unknown;
  readonly trader_side?: unknown;
  readonly maker_orders?: unknown;
  readonly proxyWallet?: unknown;
  readonly asset?: unknown;
  readonly conditionId?: unknown;
  readonly timestamp?: unknown;
  readonly transactionHash?: unknown;
  readonly outcomeIndex?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function asTradeSide(value: unknown): TradeSide | null {
  return value === "BUY" || value === "SELL" ? value : null;
}

function asTraderSide(value: unknown): TradeTraderSide | undefined {
  return value === "TAKER" || value === "MAKER" ? value : undefined;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(TRADES_QUEUE_NAME)
    private readonly tradesQueue: Queue<TradeEvent>,
  ) {}

  async backfill(conditionId: string, limit = DEFAULT_BACKFILL_LIMIT): Promise<number> {
    const market = conditionId.trim();
    if (market.length === 0) {
      return 0;
    }

    this.logger.log(`Loading history for market ${market}...`);

    const response = await fetch(this.buildTradesUrl(market, limit));
    if (!response.ok) {
      throw new Error(
        `Historical backfill request failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as unknown;
    const trades = this.extractTrades(payload);

    let added = 0;
    for (const trade of trades) {
      const event = this.mapToTradeEvent(trade);
      if (event === null) {
        continue;
      }
      await this.tradesQueue.add(TRADES_JOB_PROCESS, event);
      added += 1;
    }

    this.logger.log(`Loaded ${added} trades, added to queue`);
    return added;
  }

  private buildTradesUrl(conditionId: string, limit: number): string {
    const rawBaseUrl = this.configService.get<string>("POLYMARKET_DATA_API_URL");
    const baseUrl =
      typeof rawBaseUrl === "string" && rawBaseUrl.trim().length > 0
        ? rawBaseUrl.trim()
        : DEFAULT_POLYMARKET_DATA_API_URL;

    return `${baseUrl}/trades?market=${encodeURIComponent(conditionId)}&limit=${limit}`;
  }

  private extractTrades(payload: unknown): HistoricalTradeRaw[] {
    if (Array.isArray(payload)) {
      return payload.filter(isPlainRecord) as HistoricalTradeRaw[];
    }

    if (isPlainRecord(payload) && Array.isArray(payload["data"])) {
      return payload["data"].filter(isPlainRecord) as HistoricalTradeRaw[];
    }

    throw new Error("Historical backfill payload is invalid");
  }

  private mapToTradeEvent(trade: HistoricalTradeRaw): TradeEvent | null {
    const market =
      asNonEmptyString(trade.market) ?? asNonEmptyString(trade.conditionId);
    const assetId =
      asNonEmptyString(trade.asset_id) ?? asNonEmptyString(trade.asset);
    const side = asTradeSide(trade.side);
    const timestamp =
      asTimestamp(trade.match_time) ?? asTimestamp(trade.timestamp);
    const proxyWallet = asNonEmptyString(trade.proxyWallet);
    const makerAddress =
      asNonEmptyString(trade.maker_address) ?? proxyWallet;
    const transactionHash =
      asNonEmptyString(trade.transaction_hash) ??
      asNonEmptyString(trade.transactionHash);
    const bucketIndex = this.resolveBucketIndex(trade);
    const tradeId =
      asNonEmptyString(trade.id) ??
      this.buildPublicTradeId({
        assetId,
        bucketIndex,
        market,
        outcome: asNonEmptyString(trade.outcome),
        price: asString(trade.price),
        side,
        size: asString(trade.size),
        timestamp,
        transactionHash,
        wallet: proxyWallet,
      });

    if (
      tradeId === null ||
      market === null ||
      assetId === null ||
      side === null ||
      timestamp === null ||
      makerAddress === null
    ) {
      return null;
    }

    return {
      wallet: "",
      amount: asString(trade.size),
      side,
      price: asString(trade.price),
      market,
      assetId,
      timestamp,
      tradeId,
      owner: asNonEmptyString(trade.owner) ?? proxyWallet ?? undefined,
      takerOrderId: asNonEmptyString(trade.taker_order_id) ?? undefined,
      makerAddress,
      transactionHash: transactionHash ?? undefined,
      outcome: asNonEmptyString(trade.outcome) ?? undefined,
      bucketIndex,
      status: asNonEmptyString(trade.status) ?? undefined,
      traderSide: asTraderSide(trade.trader_side),
      feeRateBps: asNonEmptyString(trade.fee_rate_bps) ?? undefined,
      makerOrders: Array.isArray(trade.maker_orders) ? trade.maker_orders : [],
    };
  }

  private resolveBucketIndex(trade: HistoricalTradeRaw): number {
    if (typeof trade.bucket_index === "number") {
      return trade.bucket_index;
    }
    if (typeof trade.outcomeIndex === "number") {
      return trade.outcomeIndex;
    }
    return 0;
  }

  private buildPublicTradeId(input: {
    market: string | null;
    assetId: string | null;
    side: TradeSide | null;
    size: string;
    price: string;
    timestamp: number | null;
    wallet: string | null;
    transactionHash: string | null;
    outcome: string | null;
    bucketIndex: number;
  }): string | null {
    if (
      input.market === null ||
      input.assetId === null ||
      input.side === null ||
      input.timestamp === null
    ) {
      return null;
    }

    const raw = [
      input.market,
      input.assetId,
      input.side,
      input.size,
      input.price,
      String(input.timestamp),
      input.wallet ?? "",
      input.transactionHash ?? "",
      input.outcome ?? "",
      String(input.bucketIndex),
    ].join("|");

    return `public:${createHash("sha256").update(raw).digest("hex")}`;
  }
}
