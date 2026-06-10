import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { Trade } from "../trades/trade.entity.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";
import { WalletScore } from "./wallet-score.entity.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";
import { TelegramService } from "../telegram/telegram.service.js";
import { calculateResolvedTradePnl } from "./wallet-pnl.util.js";
import { computeWalletScore } from "./wallet-score.util.js";
import { computeRollingCheck, ROLLING_DEACTIVATION_THRESHOLD } from "./smart-score-rolling.util.js";
import type { WalletScoreSpecialization } from "../types/contracts.js";

/** Дефолтный порог win rate для попадания в /top и rolling-деактивации */
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
  private readonly logger = new Logger(WalletScoreService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(WalletScore)
    private readonly scoreRepo: Repository<WalletScore>,
    @InjectRepository(SmartWallet)
    private readonly smartWalletRepo: Repository<SmartWallet>,
    private readonly walletPnlV2Service: WalletPnlV2Service,
    private readonly smartWalletsService: SmartWalletsService,
    private readonly telegramService: TelegramService,
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
   * Rolling-проверка автоисключения из whitelist.
   *
   * Для каждого активного кошелька сверяет текущий win_rate из wallet_scores
   * с порогом SMART_TOP_MIN_WIN_RATE. Если ниже порога — увеличивает счётчик
   * consecutive_low_winrate_days. При достижении ROLLING_DEACTIVATION_THRESHOLD
   * деактивирует кошелёк и отправляет admin-алерт.
   *
   * Идемпотентность: проверка выполняется не более одного раза в сутки
   * (сравнение last_winrate_check_date с текущей датой).
   */
  async rollingDeactivationCheck(): Promise<void> {
    const minWinRate = Number(
      this.configService.get<number | string>("SMART_TOP_MIN_WIN_RATE", DEFAULT_SMART_TOP_MIN_WIN_RATE),
    );

    const todayStr = new Date().toISOString().slice(0, 10);

    // Загружаем все активные кошельки
    const activeWallets = await this.smartWalletRepo.find({ where: { active: true } });

    for (const wallet of activeWallets) {
      // Идемпотентность: пропускаем если уже проверяли сегодня
      if (wallet.last_winrate_check_date === todayStr) {
        continue;
      }

      // Берём текущий win_rate из wallet_scores
      const scoreRow = await this.scoreRepo.findOne({ where: { address: wallet.address } });
      const winRate = scoreRow?.win_rate !== null && scoreRow?.win_rate !== undefined
        ? Number(scoreRow.win_rate)
        : null;

      const { newConsecutiveDays, shouldDeactivate } = computeRollingCheck({
        winRate,
        consecutiveLowWinrateDays: wallet.consecutive_low_winrate_days,
        minWinRate,
      });

      if (shouldDeactivate) {
        // Деактивируем через прямое обновление и инвалидируем кэш
        await this.smartWalletRepo.update(
          { address: wallet.address },
          {
            active: false,
            consecutive_low_winrate_days: newConsecutiveDays,
            last_winrate_check_date: todayStr,
          },
        );
        this.smartWalletsService.invalidateCache();

        const winRateDisplay = winRate !== null ? `${(winRate * 100).toFixed(1)}%` : "н/д";
        await this.telegramService.sendAdminAlert(
          `🚫 Авто-исключение из whitelist\n` +
          `Адрес: ${wallet.address}\n` +
          `Винрейт: ${winRateDisplay}\n` +
          `Серия низкого винрейта: ${newConsecutiveDays} дней (порог ${ROLLING_DEACTIVATION_THRESHOLD})`,
        );
        this.logger.log(
          `Rolling-деактивация: ${wallet.address}, winRate=${winRateDisplay}, серия=${newConsecutiveDays} дней`,
        );
      } else {
        // Обновляем счётчик без деактивации
        await this.smartWalletRepo.update(
          { address: wallet.address },
          {
            consecutive_low_winrate_days: newConsecutiveDays,
            last_winrate_check_date: todayStr,
          },
        );
      }
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
