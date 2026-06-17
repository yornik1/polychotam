import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Trade } from "../trades/trade.entity.js";
import {
  calculateResolvedTradePnl,
  type ResolvedTradePnlOutcome,
} from "./wallet-pnl.util.js";
import { SmartWallet } from "./smart-wallet.entity.js";

export interface SmartWalletStats {
  address: string;
  active: boolean;
  hit_rate: string | null;
  sum_pnl: string | null;
  roi_pct: string | null;
  whale_trade_count: number;
  notes: string;
  source: string;
}

export interface SmartWalletDetail extends SmartWalletStats {
  recentTrades: Array<{
    market_question: string;
    side: string;
    size: string;
    price: string;
    match_time: Date;
    pnl: number | null;
  }>;
}

export interface SmartWalletRefreshOptions {
  dryRun?: boolean;
  freshnessDays?: number;
  minResolvedTrades?: number;
  minWinRate?: number;
  minTotalRisk?: number;
  minSelectedForDeactivation?: number;
  limit?: number;
}

export interface SmartWalletRefreshThresholds {
  freshnessDays: number;
  minResolvedTrades: number;
  minWinRate: number;
  minTotalRisk: number;
  minSelectedForDeactivation: number;
  limit: number;
}

export interface SmartWalletRefreshSkippedEntry {
  address: string;
  reason: string;
}

export interface SmartWalletRefreshResult {
  dryRun: boolean;
  selected: SmartWalletStats[];
  deactivated: string[];
  skipped: SmartWalletRefreshSkippedEntry[];
  dataGaps: string[];
  thresholds: SmartWalletRefreshThresholds;
}

interface SmartWhaleWhitelistCache {
  expiresAt: number;
  addresses: Set<string>;
  statsByAddress: Map<string, SmartWalletStats>;
}

interface SmartWalletTradeDetailRow {
  market_question: string | null;
  side: string | null;
  size: string | null;
  price: string | null;
  match_time: Date;
  winning_token_id: string | null;
  asset_id: string | null;
}

interface SmartWalletAggregate {
  address: string;
  sumPnl: number;
  totalRisk: number;
  resolvedTradeCount: number;
  winningTradeCount: number;
  lastTradeAt: Date;
  score: number;
}

interface SmartWalletRefreshRow extends SmartWalletStats {
  internal_updated_at: Date;
}

@Injectable()
export class SmartWalletsService {
  private cache: SmartWhaleWhitelistCache | null = null;
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(
    @InjectRepository(SmartWallet)
    private readonly smartWalletRepository: Repository<SmartWallet>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  async refreshSmartWallets(
    options: SmartWalletRefreshOptions = {},
  ): Promise<SmartWalletRefreshResult> {
    const thresholds = this.resolveRefreshThresholds(options);
    const now = new Date();
    const freshnessCutoff = new Date(
      now.getTime() - thresholds.freshnessDays * 24 * 60 * 60 * 1000,
    );

    const trades = await this.tradeRepository.find({
      relations: { market: true },
      order: { match_time: "ASC" },
    });

    const dataGaps = new Set<string>();
    const aggregates = this.aggregateSmartWalletCandidates(trades, freshnessCutoff, dataGaps);
    const { selectedCandidates, skipped } = this.selectSmartWalletCandidates(
      aggregates,
      thresholds,
      now,
    );
    const selectedRows = selectedCandidates.map((candidate) =>
      this.mapCandidateToWallet(candidate, now),
    );
    const selectedStats = selectedRows.map(({ internal_updated_at: _internalUpdatedAt, ...row }) => row);
    const selectedAddresses = selectedStats.map((wallet) => wallet.address);
    let deactivated: string[] = [];
    let hasMutations = false;

    if (options.dryRun === true) {
      const existingActiveWallets = await this.smartWalletRepository.find({
        where: { active: true },
      });
      deactivated = this.resolveDeactivations(
        existingActiveWallets,
        new Set(selectedAddresses.map((address) => address.toLowerCase())),
        selectedStats.length,
        thresholds.minSelectedForDeactivation,
      );
    } else {
      await this.smartWalletRepository.manager.transaction(async (manager) => {
        const walletRepository = manager.getRepository(SmartWallet);
        const existingSelectedWallets = await this.loadExistingWalletsByAddress(
          walletRepository,
          selectedAddresses,
        );
        const existingSelectedWalletsByAddress = this.indexWalletsByNormalizedAddress(
          existingSelectedWallets,
        );
        const redundantSelectedWalletAddresses =
          selectedStats.length >= thresholds.minSelectedForDeactivation
            ? existingSelectedWallets
                .filter((wallet) => {
                  const normalized = this.normalizeAddress(wallet.address);
                  const canonicalWallet = existingSelectedWalletsByAddress.get(normalized);
                  return (
                    canonicalWallet !== undefined &&
                    canonicalWallet.address !== wallet.address &&
                    wallet.source !== "manual"
                  );
                })
                .map((wallet) => wallet.address.trim())
            : [];
        const existingActiveWallets = await walletRepository.find({
          where: { active: true },
        });
        deactivated = this.resolveDeactivations(
          existingActiveWallets,
          new Set(selectedAddresses.map((address) => address.toLowerCase())),
          selectedStats.length,
          thresholds.minSelectedForDeactivation,
        );
        if (redundantSelectedWalletAddresses.length > 0) {
          deactivated = Array.from(
            new Set([...deactivated, ...redundantSelectedWalletAddresses]),
          );
        }

        for (const selectedRow of selectedRows) {
          const existingWallet = existingSelectedWalletsByAddress.get(selectedRow.address);
          if (existingWallet?.source === "manual") {
            continue;
          }

          if (existingWallet === undefined) {
            await walletRepository.insert(selectedRow);
          } else {
            await walletRepository.update({ address: existingWallet.address }, selectedRow);
          }
          hasMutations = true;
        }

        if (deactivated.length > 0) {
          await walletRepository.update({ address: In(deactivated) }, { active: false });
          hasMutations = true;
        }

      });
      if (hasMutations) {
        this.invalidateCache();
      }
    }

    return {
      dryRun: options.dryRun === true,
      selected: selectedStats,
      deactivated,
      skipped,
      dataGaps: Array.from(dataGaps),
      thresholds,
    };
  }

  /** Проверка: является ли адрес smart whale (для алертов). */
  async isSmartWhale(address: string): Promise<boolean> {
    const normalized = address.trim().toLowerCase();
    if (normalized.length === 0) {
      return false;
    }

    await this.ensureWhitelistCache();
    return this.cache!.addresses.has(normalized);
  }

  /** Метрики smart-кошелька для обогащения алерта (тот же TTL-кэш, что и whitelist). */
  async getStatsByAddress(address: string): Promise<SmartWalletStats | null> {
    const normalized = address.trim().toLowerCase();
    if (normalized.length === 0) {
      return null;
    }

    await this.ensureWhitelistCache();
    return this.cache!.statsByAddress.get(normalized) ?? null;
  }

  private async ensureWhitelistCache(): Promise<void> {
    const now = Date.now();
    if (this.cache !== null && this.cache.expiresAt > now) {
      return;
    }

    const wallets = await this.smartWalletRepository.find({
      where: { active: true },
    });
    const addresses = new Set<string>();
    const statsByAddress = new Map<string, SmartWalletStats>();
    for (const w of wallets) {
      const key = w.address.trim().toLowerCase();
      addresses.add(key);
      statsByAddress.set(key, {
        address: w.address,
        active: w.active,
        hit_rate: w.hit_rate,
        sum_pnl: w.sum_pnl,
        roi_pct: w.roi_pct,
        whale_trade_count: w.whale_trade_count,
        notes: w.notes,
        source: w.source,
      });
    }

    this.cache = {
      expiresAt: now + SmartWalletsService.CACHE_TTL_MS,
      addresses,
      statsByAddress,
    };
  }

  /** Весь активный whitelist для /whales. */
  async getActiveWhitelist(): Promise<SmartWalletStats[]> {
    const wallets = await this.smartWalletRepository.find({
      where: { active: true },
      order: { sum_pnl: "DESC" },
    });

    return wallets.map((w) => ({
      address: w.address,
      active: w.active,
      hit_rate: w.hit_rate,
      sum_pnl: w.sum_pnl,
      roi_pct: w.roi_pct,
      whale_trade_count: w.whale_trade_count,
      notes: w.notes,
      source: w.source,
    }));
  }

  /** Детали кошелька + последние 10 сделок для /whale <addr>. */
  async getWalletDetail(address: string): Promise<SmartWalletDetail | null> {
    const normalized = address.trim().toLowerCase();
    const wallet = await this.smartWalletRepository.findOne({
      where: { address: normalized },
    });

    if (wallet === null) {
      // Проверяем без lower (в БД мог быть mixed-case)
      const byOriginal = await this.smartWalletRepository
        .createQueryBuilder("sw")
        .where("LOWER(sw.address) = :addr", { addr: normalized })
        .getOne();
      if (byOriginal === null) {
        return null;
      }
      return this.buildDetail(byOriginal);
    }

    return this.buildDetail(wallet);
  }

  /** Добавить адрес в whitelist (для будущего /addwhale). */
  async addToWhitelist(address: string, notes: string): Promise<void> {
    const normalized = address.trim().toLowerCase();
    await this.smartWalletRepository.upsert(
      {
        address: normalized,
        notes,
        active: true,
        source: "manual",
      },
      ["address"],
    );
    this.cache = null;
  }

  /** Инвалидировать кэш (после ручного изменения БД). */
  invalidateCache(): void {
    this.cache = null;
  }

  private async buildDetail(wallet: SmartWallet): Promise<SmartWalletDetail> {
    const trades = await this.tradeRepository
      .createQueryBuilder("t")
      .leftJoin("t.market", "m")
      .select([
        "m.question AS market_question",
        "t.side AS side",
        "t.size AS size",
        "t.price AS price",
        "t.match_time AS match_time",
        "m.winning_token_id AS winning_token_id",
        "t.asset_id AS asset_id",
      ])
      .where("LOWER(t.maker_address) = :addr", {
        addr: wallet.address.trim().toLowerCase(),
      })
      .orderBy("t.match_time", "DESC")
      .limit(10)
      .getRawMany();

    const recentTrades = trades.map((row: SmartWalletTradeDetailRow) => {
      let pnl: number | null = null;
      if (row.winning_token_id) {
        const tradePnl: ResolvedTradePnlOutcome = calculateResolvedTradePnl(
          {
            asset_id: row.asset_id ?? "",
            side: row.side ?? "",
            size: row.size ?? "0",
            price: row.price ?? "0",
          },
          row.winning_token_id,
        );
        if (tradePnl !== "invalid_numeric" && tradePnl !== "unsupported_side") {
          pnl = tradePnl.pnl;
        }
      }
      return {
        market_question: row.market_question ?? "(unknown)",
        side: row.side ?? "",
        size: row.size ?? "0",
        price: row.price ?? "0",
        match_time: row.match_time,
        pnl,
      };
    });

    return {
      address: wallet.address,
      active: wallet.active,
      hit_rate: wallet.hit_rate,
      sum_pnl: wallet.sum_pnl,
      roi_pct: wallet.roi_pct,
      whale_trade_count: wallet.whale_trade_count,
      notes: wallet.notes,
      source: wallet.source,
      recentTrades,
    };
  }

  private resolveRefreshThresholds(
    options: SmartWalletRefreshOptions,
  ): SmartWalletRefreshThresholds {
    return {
      freshnessDays: this.normalizePositiveInt(options.freshnessDays, 90, "freshnessDays"),
      minResolvedTrades: this.normalizePositiveInt(
        options.minResolvedTrades,
        10,
        "minResolvedTrades",
      ),
      minWinRate: this.normalizePositiveNumber(options.minWinRate, 0.6),
      minTotalRisk: this.normalizePositiveNumber(options.minTotalRisk, 1000),
      minSelectedForDeactivation: this.normalizePositiveInt(
        options.minSelectedForDeactivation,
        2,
        "minSelectedForDeactivation",
      ),
      limit: this.normalizePositiveInt(options.limit, 20, "limit"),
    };
  }

  private aggregateSmartWalletCandidates(
    trades: readonly Trade[],
    freshnessCutoff: Date,
    dataGaps: Set<string>,
  ): Map<string, SmartWalletAggregate> {
    const aggregates = new Map<string, SmartWalletAggregate>();

    for (const trade of trades) {
      const address = this.normalizeAddress(trade.maker_address);
      if (address.length === 0 || address === "unknown") {
        dataGaps.add("unknown_maker_address");
        continue;
      }

      const market = trade.market;
      const winningTokenId = market?.winning_token_id;
      if (market?.closed !== true || winningTokenId === null || winningTokenId.trim().length === 0) {
        dataGaps.add("unresolved_markets_excluded");
        continue;
      }

      if (trade.match_time < freshnessCutoff) {
        dataGaps.add("outside_freshness_window");
        continue;
      }

      const tradePnl = calculateResolvedTradePnl(
        {
          asset_id: trade.asset_id,
          side: trade.side,
          size: trade.size,
          price: trade.price,
        },
        winningTokenId,
      );

      if (tradePnl === "invalid_numeric") {
        dataGaps.add("invalid_numeric_trade_values");
        continue;
      }
      if (tradePnl === "unsupported_side") {
        dataGaps.add("unsupported_trade_side");
        continue;
      }

      const aggregate = aggregates.get(address) ?? {
        address,
        sumPnl: 0,
        totalRisk: 0,
        resolvedTradeCount: 0,
        winningTradeCount: 0,
        lastTradeAt: trade.match_time,
        score: 0,
      };

      aggregate.sumPnl += tradePnl.pnl;
      aggregate.totalRisk += tradePnl.risk;
      aggregate.resolvedTradeCount += 1;
      if (tradePnl.isWinningTrade) {
        aggregate.winningTradeCount += 1;
      }
      if (trade.match_time > aggregate.lastTradeAt) {
        aggregate.lastTradeAt = trade.match_time;
      }
      aggregates.set(address, aggregate);
    }

    if (aggregates.size === 0) {
      dataGaps.add("no_resolved_trades");
    }

    return aggregates;
  }

  private selectSmartWalletCandidates(
    aggregates: ReadonlyMap<string, SmartWalletAggregate>,
    thresholds: SmartWalletRefreshThresholds,
    now: Date,
  ): {
    selectedCandidates: SmartWalletAggregate[];
    skipped: SmartWalletRefreshSkippedEntry[];
  } {
    const selectedCandidates: SmartWalletAggregate[] = [];
    const skipped: SmartWalletRefreshSkippedEntry[] = [];

    for (const aggregate of aggregates.values()) {
      const winRate =
        aggregate.resolvedTradeCount > 0
          ? aggregate.winningTradeCount / aggregate.resolvedTradeCount
          : 0;
      const roiPct = aggregate.totalRisk > 0 ? (aggregate.sumPnl / aggregate.totalRisk) * 100 : 0;
      const score = this.calculateSmartWalletScore(aggregate, winRate, roiPct, now);

      aggregate.score = score;

      const skipReasons = this.buildSkipReasons(aggregate, thresholds, winRate);
      if (skipReasons.length > 0) {
        skipped.push({
          address: aggregate.address,
          reason: skipReasons.join(", "),
        });
        continue;
      }

      selectedCandidates.push(aggregate);
    }

    selectedCandidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.sumPnl !== left.sumPnl) {
        return right.sumPnl - left.sumPnl;
      }
      if (right.resolvedTradeCount !== left.resolvedTradeCount) {
        return right.resolvedTradeCount - left.resolvedTradeCount;
      }
      if (right.lastTradeAt.getTime() !== left.lastTradeAt.getTime()) {
        return right.lastTradeAt.getTime() - left.lastTradeAt.getTime();
      }
      return left.address.localeCompare(right.address);
    });

    const limited = selectedCandidates.slice(0, thresholds.limit);
    for (const aggregate of selectedCandidates.slice(thresholds.limit)) {
      skipped.push({
        address: aggregate.address,
        reason: "limit_reached",
      });
    }

    return {
      selectedCandidates: limited,
      skipped,
    };
  }

  private buildSkipReasons(
    aggregate: SmartWalletAggregate,
    thresholds: SmartWalletRefreshThresholds,
    winRate: number,
  ): string[] {
    const reasons: string[] = [];
    if (aggregate.resolvedTradeCount < thresholds.minResolvedTrades) {
      reasons.push(`resolved<${thresholds.minResolvedTrades}`);
    }
    if (aggregate.sumPnl <= 0) {
      reasons.push("pnl<=0");
    }
    if (winRate < thresholds.minWinRate) {
      reasons.push(`winRate<${thresholds.minWinRate}`);
    }
    if (aggregate.totalRisk < thresholds.minTotalRisk) {
      reasons.push(`risk<${thresholds.minTotalRisk}`);
    }
    return reasons;
  }

  private async loadExistingWalletsByAddress(
    walletRepository: Repository<SmartWallet>,
    addresses: readonly string[],
  ): Promise<SmartWallet[]> {
    if (addresses.length === 0) {
      return [];
    }

    return walletRepository
      .createQueryBuilder("wallet")
      .where("LOWER(wallet.address) IN (:...addresses)", { addresses })
      .orderBy(
        "CASE WHEN wallet.source = 'manual' THEN 0 WHEN wallet.address = LOWER(wallet.address) THEN 1 ELSE 2 END",
        "ASC",
      )
      .addOrderBy("wallet.address", "ASC")
      .getMany();
  }

  private indexWalletsByNormalizedAddress(wallets: readonly SmartWallet[]): Map<string, SmartWallet> {
    const indexed = new Map<string, SmartWallet>();
    for (const wallet of wallets) {
      const normalized = this.normalizeAddress(wallet.address);
      const existing = indexed.get(normalized);
      if (existing === undefined) {
        indexed.set(normalized, wallet);
        continue;
      }

      if (wallet.source === "manual" && existing.source !== "manual") {
        indexed.set(normalized, wallet);
        continue;
      }

      if (existing.source === "manual") {
        continue;
      }

      if (existing.address !== normalized && wallet.address === normalized) {
        indexed.set(normalized, wallet);
      }
    }
    return indexed;
  }

  private resolveDeactivations(
    existingActiveWallets: readonly SmartWallet[],
    selectedAddresses: ReadonlySet<string>,
    selectedCount: number,
    minSelectedForDeactivation: number,
  ): string[] {
    if (selectedCount < minSelectedForDeactivation) {
      return [];
    }

    const deactivated: string[] = [];
    for (const wallet of existingActiveWallets) {
      if (wallet.source !== "auto_scoring" && wallet.source !== "research") {
        continue;
      }
      const normalized = this.normalizeAddress(wallet.address);
      if (!selectedAddresses.has(normalized)) {
        deactivated.push(wallet.address.trim());
      }
    }
    return deactivated;
  }

  private mapCandidateToWallet(
    aggregate: SmartWalletAggregate,
    now: Date,
  ): SmartWalletRefreshRow {
    const winRate =
      aggregate.resolvedTradeCount > 0
        ? aggregate.winningTradeCount / aggregate.resolvedTradeCount
        : 0;
    const roiPct = aggregate.totalRisk > 0 ? (aggregate.sumPnl / aggregate.totalRisk) * 100 : 0;

    return {
      address: aggregate.address,
      active: true,
      hit_rate: this.formatPercent(winRate, 6),
      sum_pnl: this.formatMoney(aggregate.sumPnl),
      roi_pct: this.formatPercent(roiPct, 4),
      whale_trade_count: aggregate.resolvedTradeCount,
      notes: this.buildRefreshNotes(aggregate, winRate, roiPct),
      source: "auto_scoring",
      internal_updated_at: now,
    };
  }

  private buildRefreshNotes(
    aggregate: SmartWalletAggregate,
    winRate: number,
    roiPct: number,
  ): string {
    return [
      "auto:",
      `score=${aggregate.score.toFixed(4)}`,
      `pnl=${this.formatMoney(aggregate.sumPnl)}`,
      `roi=${this.formatPercent(roiPct, 4)}%`,
      `hr=${this.formatPercent(winRate * 100, 4)}%`,
      `resolved=${aggregate.resolvedTradeCount}`,
      `risk=${this.formatMoney(aggregate.totalRisk)}`,
      `last=${aggregate.lastTradeAt.toISOString().slice(0, 10)}`,
    ].join(" ");
  }

  private calculateSmartWalletScore(
    aggregate: SmartWalletAggregate,
    winRate: number,
    roiPct: number,
    now: Date,
  ): number {
    const ageDays = Math.max(
      0,
      Math.floor((now.getTime() - aggregate.lastTradeAt.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const recencyBonus = Math.max(0, 100 - ageDays);
    return Number(
      (
        aggregate.sumPnl +
        roiPct +
        winRate * 100 +
        aggregate.resolvedTradeCount +
        recencyBonus
      ).toFixed(4),
    );
  }

  private formatMoney(value: number): string {
    if (!Number.isFinite(value)) {
      return "0";
    }

    return (Math.round(value * 100) / 100).toString();
  }

  private formatPercent(value: number, digits: number): string {
    if (!Number.isFinite(value)) {
      return "0".padEnd(digits > 0 ? digits + 2 : 1, "0");
    }

    return value.toFixed(digits);
  }

  private normalizePositiveInt(
    value: number | undefined,
    fallback: number,
    label: string,
  ): number {
    if (value === undefined) {
      return fallback;
    }

    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`${label} must be a positive integer`);
    }

    return value;
  }

  private normalizePositiveNumber(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return value;
  }

  private normalizeAddress(address: string): string {
    return address.trim().toLowerCase();
  }
}
