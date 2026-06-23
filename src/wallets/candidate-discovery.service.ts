import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { In, MoreThan, Repository } from "typeorm";
import { Market } from "../markets/market.entity.js";
import { DataApiClient } from "../polymarket/data-api.client.js";
import { QueueService } from "../queue/queue.service.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import { computeDiscoveredStats, shrinkWinRate } from "./discovered-stats.util.js";

/** Источник кошельков, найденных краулером (не из локальных сделок). */
export const DISCOVERED_SOURCE = "discovered";

export interface DiscoverFromTopMarketsOptions {
  /** Сколько топ-рынков по volume24hr просканировать. */
  markets?: number;
  /** Сколько холдеров запрашивать на рынок. */
  holdersPerMarket?: number;
  /** Минимальный размер позиции холдера (amount), чтобы попасть в кандидаты. */
  minAmount?: number;
}

export interface DiscoveryResult {
  marketsScanned: number;
  addressesFound: number;
  inserted: number;
  skippedExisting: number;
}

export interface ScoreAndPromoteOptions {
  /** Сколько discovered-кошельков обработать за проход. */
  limit?: number;
  /** Минимум resolved позиций (после shrinkage всё равно нужна выборка). */
  minSampleSize?: number;
  /** Минимальный shrink-винрейт для промоушена. */
  minWinRate?: number;
  /** Минимальный ROI для промоушена. */
  minRoi?: number;
}

export interface ScoreAndPromoteResult {
  evaluated: number;
  promoted: number;
  rejected: number;
  failed: number;
}

@Injectable()
export class CandidateDiscoveryService {
  private readonly logger = new Logger(CandidateDiscoveryService.name);

  constructor(
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    @InjectRepository(SmartWallet)
    private readonly smartWalletRepository: Repository<SmartWallet>,
    private readonly dataApiClient: DataApiClient,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Краулит топ-рынки по volume24hr, собирает крупных холдеров обоих исходов
   * и заносит новых (которых ещё нет в smart_wallets) как discovered/active=false.
   * Существующие записи любого источника не трогаются.
   */
  async discoverFromTopMarkets(
    options: DiscoverFromTopMarketsOptions = {},
  ): Promise<DiscoveryResult> {
    const markets = this.resolveInt(options.markets, "DISCOVERY_TOP_MARKETS", 20);
    const holdersPerMarket = this.resolveInt(
      options.holdersPerMarket,
      "DISCOVERY_HOLDERS_PER_MARKET",
      50,
    );
    const minAmount = this.resolveNumber(options.minAmount, "DISCOVERY_MIN_AMOUNT", 100);

    const topMarkets = await this.marketRepository.find({
      where: { volume24hr: MoreThan(0) },
      order: { volume24hr: "DESC" },
      take: markets,
    });

    const candidates = new Set<string>();
    for (const market of topMarkets) {
      try {
        const groups = await this.dataApiClient.fetchHolders(
          market.condition_id,
          holdersPerMarket,
        );
        for (const group of groups) {
          for (const holder of group.holders) {
            if (holder.amount >= minAmount) {
              const addr = holder.proxyWallet.trim().toLowerCase();
              if (addr.length > 0) {
                candidates.add(addr);
              }
            }
          }
        }
      } catch (error: unknown) {
        // Изоляция на рынок: ошибка Data API по одному рынку не рвёт весь проход.
        const message = error instanceof Error ? error.message : "unknown";
        this.logger.warn(`discovery: рынок ${market.condition_id} пропущен: ${message}`);
      }
    }

    const addresses = Array.from(candidates);
    if (addresses.length === 0) {
      return { marketsScanned: topMarkets.length, addressesFound: 0, inserted: 0, skippedExisting: 0 };
    }

    const existing = await this.smartWalletRepository.find({
      where: { address: In(addresses) },
      select: { address: true },
    });
    const existingSet = new Set(existing.map((w) => w.address.trim().toLowerCase()));

    const toInsert = addresses.filter((addr) => !existingSet.has(addr));
    for (const addr of toInsert) {
      await this.smartWalletRepository.insert({
        address: addr,
        source: DISCOVERED_SOURCE,
        active: false,
        notes: "discovered: holders of top market",
      });
    }

    return {
      marketsScanned: topMarkets.length,
      addressesFound: addresses.length,
      inserted: toInsert.length,
      skippedExisting: addresses.length - toInsert.length,
    };
  }

  /**
   * Скорит discovered-кошельки через Data API (closed-positions) и промоутит
   * прошедших гейты в active=true. Использует чистый computeDiscoveredStats +
   * shrinkWinRate; отсекает фермеров и outlier-driven. Изоляция ошибок на кошелёк.
   */
  async scoreAndPromoteDiscovered(
    options: ScoreAndPromoteOptions = {},
  ): Promise<ScoreAndPromoteResult> {
    const limit = this.resolveInt(options.limit, "DISCOVERY_PROMOTE_LIMIT", 50);
    const minSampleSize = this.resolveInt(options.minSampleSize, "DISCOVERY_MIN_SAMPLE", 30);
    const minWinRate = this.resolveNumber(options.minWinRate, "DISCOVERY_MIN_WIN_RATE", 0.55);
    const minRoi = this.resolveNumber(options.minRoi, "DISCOVERY_MIN_ROI", 0);
    const delayMs = this.resolveNumber(undefined, "DISCOVERY_PROMOTE_DELAY_MS", 0);

    const discovered = await this.smartWalletRepository.find({
      where: { source: DISCOVERED_SOURCE, active: false },
      take: limit,
    });

    let evaluated = 0;
    let promoted = 0;
    let rejected = 0;
    let failed = 0;

    for (const [i, wallet] of discovered.entries()) {
      try {
        const positions = await this.dataApiClient.fetchClosedPositions(wallet.address);
        const stats = computeDiscoveredStats(positions);
        evaluated += 1;

        const shrunkWinRate = shrinkWinRate(stats.winRate, stats.sampleSize);
        const pass =
          stats.sampleSize >= minSampleSize &&
          !stats.isFarmer &&
          !stats.isOutlierDriven &&
          shrunkWinRate >= minWinRate &&
          stats.roi >= minRoi;

        if (pass) {
          await this.smartWalletRepository.update(
            { address: wallet.address },
            {
              active: true,
              hit_rate: shrunkWinRate.toFixed(6),
              sum_pnl: stats.realizedPnl.toFixed(2),
              roi_pct: (stats.roi * 100).toFixed(4),
              whale_trade_count: stats.sampleSize,
              notes: `promoted: wr=${shrunkWinRate.toFixed(3)} edge=${stats.edgeVsImplied.toFixed(3)} insider=${stats.insiderScore.toFixed(2)} n=${stats.sampleSize}`,
            },
          );
          promoted += 1;
        } else {
          rejected += 1;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown";
        this.logger.warn(`promote: кошелёк ${wallet.address} пропущен: ${message}`);
        failed += 1;
      }

      if (delayMs > 0 && i < discovered.length - 1) {
        await this.delay(delayMs);
      }
    }

    return { evaluated, promoted, rejected, failed };
  }

  /**
   * Ставит recent /activity backfill (PnL v2 recalc) для discovered-пула.
   * jobId = адрес → коалесцирование, без дублей. Прогревает PnL-снапшоты,
   * чтобы после промоушена данные уже были готовы.
   */
  async enqueuePnlBackfillForDiscovered(limit?: number): Promise<number> {
    const max = this.resolveInt(limit, "DISCOVERY_BACKFILL_LIMIT", 100);
    const discovered = await this.smartWalletRepository.find({
      where: { source: DISCOVERED_SOURCE, active: false },
      take: max,
      select: { address: true },
    });
    for (const wallet of discovered) {
      await this.queueService.enqueueWalletPnlRecalc(wallet.address);
    }
    return discovered.length;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resolveInt(value: number | undefined, envKey: string, fallback: number): number {
    if (value !== undefined && Number.isInteger(value) && value > 0) {
      return value;
    }
    const raw = this.configService.get<string | number>(envKey);
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private resolveNumber(value: number | undefined, envKey: string, fallback: number): number {
    if (value !== undefined && Number.isFinite(value) && value >= 0) {
      return value;
    }
    const raw = this.configService.get<string | number>(envKey);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
