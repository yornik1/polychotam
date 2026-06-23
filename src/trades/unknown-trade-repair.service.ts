import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LiveTradeEnricherService } from "../polymarket/live-trade-enricher.service.js";
import type { TradeEnrichmentJob, TradeSide } from "../types/contracts.js";
import { Trade } from "./trade.entity.js";
import { TradesService } from "./trades.service.js";

const DEFAULT_REPAIR_LIMIT = 100;

export interface UnknownTradeRepairBatchOptions {
  readonly limit?: number;
  readonly dryRun?: boolean;
  /** Пауза между строками в мс — троттлинг Data API при массовом дренаже. */
  readonly delayMs?: number;
  /**
   * Порядок выборки: 'whale' — по notional (size*price) DESC, крупные первыми;
   * 'recent' — по match_time DESC, свежие первыми (эффективный массовый дренаж,
   * т.к. Data API хранит только недавние сделки).
   */
  readonly order?: UnknownTradeRepairOrder;
}

export type UnknownTradeRepairOrder = "whale" | "recent";

export interface UnknownTradeRepairResult {
  readonly scanned: number;
  readonly updated: number;
  readonly missed: number;
  readonly failed: number;
}

interface UnknownTradeRepairRow {
  readonly id: string;
  readonly market: string;
  readonly asset_id: string;
  readonly side: TradeSide;
  readonly size: string;
  readonly price: string;
  readonly match_time: Date | string | number;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_REPAIR_LIMIT;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return Math.floor(limit);
}

function normalizeDelayMs(delayMs: number | undefined): number {
  if (delayMs === undefined || !Number.isFinite(delayMs) || delayMs <= 0) {
    return 0;
  }
  return Math.floor(delayMs);
}

function matchTimeToSeconds(value: Date | string | number): number {
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  if (typeof value === "number") {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  return Math.floor(new Date(value).getTime() / 1000);
}

@Injectable()
export class UnknownTradeRepairService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly liveTradeEnricherService: LiveTradeEnricherService,
    private readonly tradesService: TradesService,
  ) {}

  async repairBatch(
    options: UnknownTradeRepairBatchOptions = {},
  ): Promise<UnknownTradeRepairResult> {
    const limit = normalizeLimit(options.limit);
    if (limit === 0) {
      return { scanned: 0, updated: 0, missed: 0, failed: 0 };
    }

    const queryBuilder = this.tradeRepository
      .createQueryBuilder("t")
      .select("t.id", "id")
      .addSelect("t.market", "market")
      .addSelect("t.asset_id", "asset_id")
      .addSelect("t.side", "side")
      .addSelect("t.size", "size")
      .addSelect("t.price", "price")
      .addSelect("t.match_time", "match_time")
      .where("t.status = :status", { status: "RECORDED_WS" })
      .andWhere("(t.maker_address = :unknown OR t.maker_address = :blank)", {
        unknown: "unknown",
        blank: "",
      });

    if (options.order === "recent") {
      queryBuilder.orderBy("t.match_time", "DESC");
    } else {
      queryBuilder.orderBy("(t.size::numeric * t.price::numeric)", "DESC");
    }

    const rows = await queryBuilder
      .addOrderBy("t.id", "ASC")
      .limit(limit)
      .getRawMany<UnknownTradeRepairRow>();

    let updated = 0;
    let missed = 0;
    let failed = 0;
    const delayMs = normalizeDelayMs(options.delayMs);

    for (const [i, row] of rows.entries()) {
      // Изоляция на строку: transient-ошибка Data API (429/5xx) не должна
      // обрывать весь bounded-батч — считаем её failed и идём дальше.
      try {
        const makerAddress = await this.liveTradeEnricherService.findMakerAddress(
          this.toEnrichmentJob(row),
        );
        if (makerAddress !== null) {
          if (options.dryRun !== true) {
            await this.tradesService.updateMakerAddress(row.id, makerAddress);
          }
          updated += 1;
        } else {
          missed += 1;
        }
      } catch {
        failed += 1;
      }

      // Троттлинг: пауза между строками, но не после последней.
      if (delayMs > 0 && i < rows.length - 1) {
        await this.delay(delayMs);
      }
    }

    return {
      scanned: rows.length,
      updated,
      missed,
      failed,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private toEnrichmentJob(row: UnknownTradeRepairRow): TradeEnrichmentJob {
    return {
      tradeRecordId: row.id,
      market: row.market,
      assetId: row.asset_id,
      side: row.side,
      amount: row.size,
      price: row.price,
      timestamp: matchTimeToSeconds(row.match_time),
    };
  }
}
