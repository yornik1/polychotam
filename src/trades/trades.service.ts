import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { Market } from "../markets/market.entity.js";
import { buildWsTradeRecordId } from "./trade-id.util.js";
import { Trade } from "./trade.entity.js";

type HistoricalTradeEvent = TradeEvent & {
  tradeId: string;
};
type TradeUpsertPayload = Parameters<Repository<Trade>["upsert"]>[0];

/** Результат записи WS-сделки для ветвления в TradesProcessor (алерты / enrichment). */
export type SaveWsTradeOutcome =
  | "skipped_empty_market"
  | "historical_upserted"
  | "inserted_live"
  | "duplicate_live";

/**
 * Событие last_trade_price не содержит полного CLOB Trade — поля без данных
 * заполняются заглушками с префиксом ws- / RECORDED_WS.
 */
@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
  ) {}

  /**
   * Идемпотентная запись: один и тот же payload WS даёт один и тот же `id` (повторы BullMQ безопасны).
   */
  async saveFromWsTradeEvent(event: TradeEvent): Promise<SaveWsTradeOutcome> {
    const conditionId = event.market.trim();
    if (conditionId.length === 0) {
      this.logger.warn(
        "Пропуск сохранения сделки WS: пустой market (condition id)",
      );
      return "skipped_empty_market";
    }

    const market = await this.ensureMarketStub(conditionId);
    const historicalEvent = this.asHistoricalTradeEvent(event);
    if (historicalEvent !== null) {
      await this.upsertHistoricalTrade(market, historicalEvent);
      return "historical_upserted";
    }

    const id = buildWsTradeRecordId(event);
    const matchTime = this.tradeTimestampToDate(event.timestamp);
    const wallet = event.wallet.trim() || "unknown";

    const existing = await this.tradeRepository.findOne({ where: { id } });
    if (existing !== null) {
      return "duplicate_live";
    }

    const trade = this.tradeRepository.create({
      id,
      taker_order_id: `ws-taker-${id.slice(3, 67)}`,
      market,
      asset_id: event.assetId,
      side: event.side,
      size: event.amount,
      fee_rate_bps: "0",
      price: event.price,
      status: "RECORDED_WS",
      match_time: matchTime,
      last_update: matchTime,
      outcome: "",
      bucket_index: 0,
      owner: wallet,
      maker_address: wallet,
      maker_orders: [],
      transaction_hash: "",
      trader_side: event.side,
    });

    await this.tradeRepository.save(trade);
    return "inserted_live";
  }

  /**
   * Live WS-строка ещё без реального maker (нужен enrichment).
   */
  async isWsTradePendingEnrichment(tradeRecordId: string): Promise<boolean> {
    const normalizedId = tradeRecordId.trim();
    if (normalizedId.length === 0) {
      return false;
    }

    const row = await this.tradeRepository.findOne({
      where: { id: normalizedId },
      select: { maker_address: true, status: true },
    });
    if (row === null) {
      return false;
    }
    if (row.status !== "RECORDED_WS") {
      return false;
    }
    const maker = row.maker_address?.trim() ?? "";
    return maker.length === 0 || maker.toLowerCase() === "unknown";
  }

  async updateMakerAddress(tradeRecordId: string, makerAddress: string): Promise<void> {
    const normalizedAddress = makerAddress.trim();
    if (tradeRecordId.trim().length === 0 || normalizedAddress.length === 0) {
      return;
    }

    await this.tradeRepository.update(
      { id: tradeRecordId },
      { maker_address: normalizedAddress, owner: normalizedAddress },
    );
  }

  private asHistoricalTradeEvent(event: TradeEvent): HistoricalTradeEvent | null {
    const tradeId = event.tradeId?.trim();
    if (tradeId === undefined || tradeId.length === 0) {
      return null;
    }

    return {
      ...event,
      tradeId,
    };
  }

  private async upsertHistoricalTrade(
    market: Market,
    event: HistoricalTradeEvent,
  ): Promise<void> {
    const matchTime = this.tradeTimestampToDate(event.timestamp);
    const owner =
      event.owner?.trim() || event.wallet.trim() || event.makerAddress?.trim() || "unknown";
    const makerAddress = event.makerAddress?.trim() || event.wallet.trim() || owner;

    const trade = {
      id: event.tradeId,
      trade_id: event.tradeId,
      taker_order_id: event.takerOrderId?.trim() || event.tradeId,
      market: market.condition_id,
      asset_id: event.assetId,
      side: event.side,
      size: event.amount,
      fee_rate_bps: event.feeRateBps?.trim() || "0",
      price: event.price,
      status: event.status?.trim() || "MATCHED",
      match_time: matchTime,
      last_update: matchTime,
      outcome: event.outcome?.trim() || "",
      bucket_index: event.bucketIndex ?? 0,
      owner,
      maker_address: makerAddress,
      maker_orders: event.makerOrders ?? [],
      transaction_hash: event.transactionHash?.trim() || "",
      trader_side: event.traderSide ?? "TAKER",
    } as unknown as TradeUpsertPayload;

    await this.tradeRepository.upsert(trade, ["trade_id"]);
  }

  /** Секунды или миллисекунды от upstream — эвристика как у многих WS API. */
  private tradeTimestampToDate(ts: number): Date {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms);
  }

  /**
   * Маркет из HTTP в БД пока не синхронизируется — для FK `trades.market` поднимаем минимальную строку.
   */
  private async ensureMarketStub(conditionId: string): Promise<Market> {
    const existing = await this.marketRepository.findOne({
      where: { condition_id: conditionId },
    });
    if (existing !== null) {
      return existing;
    }

    const slug = `ws-${createHash("sha256").update(conditionId).digest("hex")}`;
    const stub = this.marketRepository.create({
      condition_id: conditionId,
      question: `(ws) ${conditionId}`,
      market_slug: slug,
      tokens: [],
      active: true,
      closed: false,
      accepting_orders: null,
      liquidity: 0,
      volume24hr: 0,
      end_date_iso: null,
      internal_synced_at: null,
    });

    await this.marketRepository.save(stub);
    const created = await this.marketRepository.findOne({
      where: { condition_id: conditionId },
    });
    if (created === null) {
      throw new Error(`Не удалось создать маркет-заглушку для ${conditionId}`);
    }
    return created;
  }
}
