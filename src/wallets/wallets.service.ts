import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type {
  WalletPnlDataGapCode,
  WalletPnlQueryOptions,
  WalletPnlSummary,
  WalletUpsertInput,
} from "../types/contracts.js";
import { Trade } from "../trades/trade.entity.js";
import { Wallet } from "./wallet.entity.js";
import {
  calculateResolvedTradePnl,
  type ResolvedTradePnlOutcome,
} from "./wallet-pnl.util.js";

const TOP_WALLETS_CACHE_TTL_MS = 60_000;
const WALLET_PNL_LIMITATIONS = [
  "Only local trades stored in this database are included.",
  "Only resolved markets with winning_token_id are included.",
  "Only maker_address matches are included; owner/taker identity is not expanded.",
  "This is not full on-chain wallet P&L.",
  "ROI is calculated from totalRisk, not from volume.",
];

@Injectable()
export class WalletsService {
  private topWalletsCache: { expiresAt: number; addresses: Set<string> } | null = null;

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  /**
   * Создаёт или обновляет строку кошелька одним запросом (ON CONFLICT по address).
   */
  async upsert(data: WalletUpsertInput): Promise<void> {
    await this.walletRepository.upsert(
      {
        ...data,
        internal_updated_at: new Date(),
      },
      ["address"],
    );
    this.topWalletsCache = null;
  }

  async recalculate(address: string): Promise<void> {
    const normalizedAddress = address.trim();
    const trades = await this.tradeRepository.find({
      where: { maker_address: normalizedAddress },
      relations: { market: true },
      order: { match_time: "ASC" },
    });

    let totalWon = 0;
    let totalLost = 0;
    let winningTrades = 0;
    let resolvedTrades = 0;

    for (const trade of trades) {
      const winningTokenId = trade.market?.winning_token_id;
      if (trade.market?.closed !== true || winningTokenId === null) {
        continue;
      }

      const tradePnl = calculateResolvedTradePnl(trade, winningTokenId);
      if (tradePnl === "invalid_numeric" || tradePnl === "unsupported_side") {
        continue;
      }

      if (tradePnl.isWinningTrade) {
        totalWon += tradePnl.pnl;
        winningTrades += 1;
      } else {
        totalLost += tradePnl.risk;
      }
      resolvedTrades += 1;
    }

    await this.upsert({
      address: normalizedAddress,
      total_won: this.formatDecimal(totalWon),
      total_lost: this.formatDecimal(totalLost),
      win_rate: this.formatRate(resolvedTrades === 0 ? 0 : winningTrades / resolvedTrades),
      trade_count: resolvedTrades,
    });
  }

  async getHistoricalPnl(
    address: string,
    options: WalletPnlQueryOptions = {},
  ): Promise<WalletPnlSummary> {
    const normalizedAddress = address.trim();
    const normalizedAddressKey = normalizedAddress.toLowerCase();
    const trades = await this.tradeRepository
      .createQueryBuilder("trade")
      .leftJoinAndSelect("trade.market", "market")
      .where("LOWER(trade.maker_address) = :address", { address: normalizedAddressKey })
      .orderBy("trade.match_time", "ASC")
      .getMany();

    let totalPnl = 0;
    let totalRisk = 0;
    let winningTrades = 0;
    let includedTradeCount = 0;
    let skippedTradeCount = 0;
    const dataGaps = new Set<WalletPnlDataGapCode>();

    for (const trade of trades) {
      if (options.from !== undefined && trade.match_time < options.from) {
        skippedTradeCount += 1;
        dataGaps.add("outside_period_excluded");
        continue;
      }

      if (trade.maker_address.trim().toLowerCase() !== normalizedAddressKey) {
        skippedTradeCount += 1;
        dataGaps.add("maker_address_only");
        continue;
      }

      const winningTokenId = trade.market?.winning_token_id;
      if (trade.market?.closed !== true || winningTokenId === null) {
        skippedTradeCount += 1;
        dataGaps.add("unresolved_markets_excluded");
        continue;
      }

      const tradePnl: ResolvedTradePnlOutcome = calculateResolvedTradePnl(trade, winningTokenId);
      if (tradePnl === "invalid_numeric") {
        skippedTradeCount += 1;
        dataGaps.add("invalid_numeric_trade_values");
        continue;
      }
      if (tradePnl === "unsupported_side") {
        skippedTradeCount += 1;
        dataGaps.add("unsupported_trade_side");
        continue;
      }

      totalPnl += tradePnl.pnl;
      totalRisk += tradePnl.risk;
      includedTradeCount += 1;
      if (tradePnl.isWinningTrade) {
        winningTrades += 1;
      }
    }

    if (includedTradeCount === 0) {
      dataGaps.add("no_resolved_trades");
    }
    if (totalRisk === 0) {
      dataGaps.add("zero_risk_basis");
    }

    return {
      address: normalizedAddress,
      method: "resolved_only_local_trades",
      period: {
        from: options.from?.toISOString() ?? null,
        days: options.days ?? null,
      },
      totalPnl: this.roundMetric(totalPnl),
      totalRisk: this.roundMetric(totalRisk),
      roi: totalRisk > 0 ? this.roundMetric(totalPnl / totalRisk) : null,
      winRate: includedTradeCount > 0 ? this.roundMetric(winningTrades / includedTradeCount) : null,
      includedTradeCount,
      skippedTradeCount,
      dataGaps: Array.from(dataGaps),
      limitations: WALLET_PNL_LIMITATIONS,
    };
  }

  async getTopWallets(limit = 10): Promise<Wallet[]> {
    return this.walletRepository
      .createQueryBuilder("wallet")
      .where("wallet.trade_count >= :minTradeCount", { minTradeCount: 5 })
      .andWhere(
        "(wallet.win_rate > :zero OR wallet.total_won > :zero OR wallet.total_lost > :zero)",
        { zero: "0" },
      )
      .orderBy("wallet.win_rate", "DESC")
      .limit(limit)
      .getMany();
  }

  async isTopWallet(address: string): Promise<boolean> {
    const normalizedAddress = address.trim();
    if (normalizedAddress.length === 0) {
      return false;
    }

    const now = Date.now();
    if (this.topWalletsCache === null || this.topWalletsCache.expiresAt <= now) {
      const wallets = await this.getTopWallets(10);
      this.topWalletsCache = {
        expiresAt: now + TOP_WALLETS_CACHE_TTL_MS,
        addresses: new Set(wallets.map((wallet) => wallet.address.trim())),
      };
    }

    return this.topWalletsCache.addresses.has(normalizedAddress);
  }

  /**
   * Топ-кошельки по объёму торговли на топовых маркетах (volume24hr > 1M) за последние 7 дней.
   * Объём в USDC: в CLOB `size` — количество outcome-токенов, `price` — USDC за токен,
   * значит USD за сделку = size × price. Учитываются только сделки с объёмом > $10,000 USDC.
   * Используется для алертов о сделках китов на активных маркетах и команды /top.
   */
  async getTopWalletsByVolumeOnTopMarkets(
    limit = 10,
  ): Promise<Array<{ address: string; totalVolume: string; tradeCount: number }>> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const minTradeSize = 10000; // Минимальный объём сделки в USDC для учёта

    const result = await this.tradeRepository
      .createQueryBuilder("trade")
      .select("trade.maker_address", "address")
      .addSelect(
        "SUM(CAST(trade.size AS DECIMAL) * CAST(trade.price AS DECIMAL))",
        "total_volume",
      )
      .addSelect("COUNT(*)", "trade_count")
      .innerJoin("trade.market", "market")
      .where("market.volume24hr > :minVolume", { minVolume: 1000000 })
      .andWhere("trade.match_time >= :since", { since: sevenDaysAgo })
      .andWhere("trade.maker_address IS NOT NULL")
      .andWhere("trade.maker_address != :unknown", { unknown: "unknown" })
      .andWhere(
        "CAST(trade.size AS DECIMAL) * CAST(trade.price AS DECIMAL) > :minTradeSize",
        { minTradeSize },
      )
      .groupBy("trade.maker_address")
      .orderBy("total_volume", "DESC")
      .limit(limit)
      .getRawMany<{ address: string; total_volume: string; trade_count: string }>();

    return result
      .map((row) => ({
        address: row.address.trim(),
        totalVolume: row.total_volume,
        tradeCount: Number(row.trade_count),
      }))
      .filter((item) => item.address.length > 0);
  }

  private formatDecimal(value: number): string {
    if (!Number.isFinite(value) || value === 0) {
      return "0";
    }

    return value.toString();
  }

  private formatRate(value: number): string {
    if (!Number.isFinite(value) || value === 0) {
      return "0";
    }

    return value.toFixed(6);
  }

  private roundMetric(value: number): number {
    if (!Number.isFinite(value) || value === 0) {
      return 0;
    }

    return Number(value.toFixed(6));
  }
}
