import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { Trade } from "../trades/trade.entity.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";
import { WalletScore } from "./wallet-score.entity.js";
import { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";
import { calculateResolvedTradePnl } from "./wallet-pnl.util.js";
import { computeWalletScore } from "./wallet-score.util.js";
import type { WalletScoreSpecialization } from "../types/contracts.js";

/** Дефолтный порог win rate для попадания в /top */
const DEFAULT_SMART_TOP_MIN_WIN_RATE = 0.55;

/** Категории маркетов для специализации */
type MarketCategory = "politics" | "sports" | "crypto" | "other";

/**
 * Сервис пересчёта и чтения скоринговых записей кошельков.
 *
 * recalcScores() — полный цикл пересчёта для активного whitelist.
 * getTopByScore(limit) — топ кошельков из wallet_scores,
 *   только validated=true + win_rate >= SMART_TOP_MIN_WIN_RATE.
 */
@Injectable()
export class WalletScoreService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(WalletScore)
    private readonly scoreRepo: Repository<WalletScore>,
    private readonly walletPnlV2Service: WalletPnlV2Service,
    private readonly smartWalletsService: SmartWalletsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Пересчитывает скоры для всего активного whitelist.
   * Кошельки с sampleSize < 30 (score=null) удаляются/не пишутся в таблицу.
   */
  async recalcScores(): Promise<void> {
    const whitelist = await this.smartWalletsService.getActiveWhitelist();

    for (const wallet of whitelist) {
      await this.recalcOne(wallet.address);
    }
  }

  /**
   * Пересчёт скора для одного адреса.
   */
  private async recalcOne(address: string): Promise<void> {
    const now = new Date();
    // Граница rolling 90d
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Загружаем resolved сделки за 90 дней с джойном на market
    const trades = await this.tradeRepo
      .createQueryBuilder("trade")
      .innerJoinAndSelect("trade.market", "market")
      .where("trade.maker_address = :address", { address })
      .andWhere("trade.match_time >= :cutoff", { cutoff })
      .andWhere("market.closed = true")
      .andWhere("market.winning_token_id IS NOT NULL")
      .getMany();

    const sampleSize = trades.length;

    // Агрегируем win rate, profit factor, специализацию
    let wins = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    // Для специализации: по категории хранятся wins и total
    const catStats: Record<MarketCategory, { wins: number; total: number }> = {
      politics: { wins: 0, total: 0 },
      sports: { wins: 0, total: 0 },
      crypto: { wins: 0, total: 0 },
      other: { wins: 0, total: 0 },
    };

    for (const trade of trades) {
      const winningTokenId = trade.market.winning_token_id!;
      const outcome = calculateResolvedTradePnl(trade, winningTokenId);

      if (outcome === "invalid_numeric" || outcome === "unsupported_side") {
        continue;
      }

      if (outcome.isWinningTrade) {
        wins++;
      }

      if (outcome.pnl > 0) {
        totalProfit += outcome.pnl;
      } else {
        totalLoss += Math.abs(outcome.pnl);
      }

      // Определяем категорию: null → other
      const rawCategory = trade.market.category;
      const cat: MarketCategory = isMarketCategory(rawCategory) ? rawCategory : "other";
      catStats[cat].total++;
      if (outcome.isWinningTrade) {
        catStats[cat].wins++;
      }
    }

    const winRate = sampleSize > 0 ? wins / sampleSize : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : null;

    // Специализация: winRate по каждой категории
    const specialization: WalletScoreSpecialization = {
      politics: {
        winRate: catStats.politics.total > 0 ? catStats.politics.wins / catStats.politics.total : null,
        resolvedCount: catStats.politics.total,
      },
      sports: {
        winRate: catStats.sports.total > 0 ? catStats.sports.wins / catStats.sports.total : null,
        resolvedCount: catStats.sports.total,
      },
      crypto: {
        winRate: catStats.crypto.total > 0 ? catStats.crypto.wins / catStats.crypto.total : null,
        resolvedCount: catStats.crypto.total,
      },
      other: {
        winRate: catStats.other.total > 0 ? catStats.other.wins / catStats.other.total : null,
        resolvedCount: catStats.other.total,
      },
    };

    // PnL 90d через WalletPnlV2Service
    let pnl90d: number;
    try {
      const summary = await this.walletPnlV2Service.getOrComputePnl(address, "90d");
      pnl90d = summary.totalPnl;
    } catch {
      // Если PnL недоступен — пропускаем кошелёк
      return;
    }

    // Защита от NaN из коррумпированного снапшота: NaN молча прошёл бы
    // через всю нормировку и записал бы score="NaN" в numeric-колонку
    if (!Number.isFinite(pnl90d)) {
      return;
    }

    const score = computeWalletScore({ pnl90d, winRate, profitFactor, sampleSize });

    if (score === null) {
      // sampleSize < 30 — удаляем существующую запись если есть
      await this.scoreRepo.delete({ address });
      return;
    }

    // Upsert записи
    await this.scoreRepo.upsert(
      {
        address,
        pnl_90d: String(pnl90d),
        win_rate: String(winRate),
        profit_factor: profitFactor !== null ? String(profitFactor) : null,
        specialization,
        sample_size: sampleSize,
        score: String(score),
        computed_at: now,
      },
      ["address"],
    );
  }

  /**
   * Топ кошельков по score из wallet_scores.
   * Фильтр: validated=true в wallet_pnl_snapshots (window="all")
   * И win_rate строго > SMART_TOP_MIN_WIN_RATE (acceptance Фазы 1: «винрейт >55%»).
   * Сортировка по score DESC.
   */
  async getTopByScore(limit: number): Promise<WalletScore[]> {
    // Number(): env приходит строкой, а дефолт — числом; тип параметра запроса должен быть одинаковым
    const minWinRate = Number(
      this.configService.get<number | string>(
        "SMART_TOP_MIN_WIN_RATE",
        DEFAULT_SMART_TOP_MIN_WIN_RATE,
      ),
    );

    // JOIN с wallet_pnl_snapshots (window="all") — только validated=true
    return this.scoreRepo
      .createQueryBuilder("ws")
      .innerJoin(
        WalletPnlSnapshot,
        "snap",
        "snap.address = ws.address AND snap.window = :window AND snap.validated = true",
        { window: "all" },
      )
      .where("CAST(ws.win_rate AS double precision) > :minWinRate", { minWinRate })
      .orderBy("CAST(ws.score AS double precision)", "DESC")
      .limit(limit)
      .getMany();
  }
}

/** Проверяет, является ли строка допустимой категорией маркета. */
function isMarketCategory(value: string | null | undefined): value is MarketCategory {
  return value === "politics" || value === "sports" || value === "crypto" || value === "other";
}
