import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { Market } from "../markets/market.entity.js";
import { Trade } from "./trade.entity.js";

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
  async saveFromWsTradeEvent(event: TradeEvent): Promise<void> {
    const conditionId = event.market.trim();
    if (conditionId.length === 0) {
      this.logger.warn(
        "Пропуск сохранения сделки WS: пустой market (condition id)",
      );
      return;
    }

    const market = await this.ensureMarketStub(conditionId);
    const id = this.buildWsTradeId(event);
    const matchTime = this.tradeTimestampToDate(event.timestamp);
    const wallet = event.wallet.trim() || "unknown";

    const existing = await this.tradeRepository.findOne({ where: { id } });
    if (existing !== null) {
      return;
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
  }

  private buildWsTradeId(event: TradeEvent): string {
    const raw = `${event.market}|${event.assetId}|${event.timestamp}|${event.side}|${event.price}|${event.amount}`;
    const hash = createHash("sha256").update(raw).digest("hex");
    return `ws:${hash}`;
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
