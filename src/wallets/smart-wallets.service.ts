import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SmartWallet } from "./smart-wallet.entity.js";
import { Trade } from "../trades/trade.entity.js";

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

interface SmartWhaleWhitelistCache {
  expiresAt: number;
  addresses: Set<string>;
  statsByAddress: Map<string, SmartWalletStats>;
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

    const recentTrades = trades.map((row) => {
      let pnl: number | null = null;
      if (row.winning_token_id) {
        const size = Number(row.size);
        const price = Number(row.price);
        const side = (row.side ?? "").toUpperCase();
        const isWin = row.asset_id === row.winning_token_id;
        if (Number.isFinite(size) && Number.isFinite(price)) {
          if (side === "BUY") {
            pnl = isWin ? size * (1 - price) : -size * price;
          } else if (side === "SELL") {
            pnl = isWin ? -size * (1 - price) : size * price;
          }
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
}
