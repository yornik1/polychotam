import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { WalletUpsertInput } from "../types/contracts.js";
import { Trade } from "../trades/trade.entity.js";
import { Wallet } from "./wallet.entity.js";

const TOP_WALLETS_CACHE_TTL_MS = 60_000;

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

      const size = Number(trade.size);
      const price = Number(trade.price);
      if (!Number.isFinite(size) || !Number.isFinite(price)) {
        continue;
      }

      const isWinningToken = trade.asset_id === winningTokenId;
      const side = trade.side.toUpperCase();

      if (side === "BUY") {
        if (isWinningToken) {
          totalWon += size * (1 - price);
          winningTrades += 1;
        } else {
          totalLost += size * price;
        }
        resolvedTrades += 1;
        continue;
      }

      if (side === "SELL") {
        if (isWinningToken) {
          totalLost += size * (1 - price);
        } else {
          totalWon += size * price;
          winningTrades += 1;
        }
        resolvedTrades += 1;
      }
    }

    await this.upsert({
      address: normalizedAddress,
      total_won: this.formatDecimal(totalWon),
      total_lost: this.formatDecimal(totalLost),
      win_rate: this.formatRate(resolvedTrades === 0 ? 0 : winningTrades / resolvedTrades),
      trade_count: resolvedTrades,
    });
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
}
