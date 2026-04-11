import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import type { WalletRecalculateJob } from "../types/contracts.js";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import {
  WALLET_ANALYTICS_JOB_RECALCULATE,
  WALLET_ANALYTICS_QUEUE_NAME,
} from "../queue/trades-queue.config.js";

@Injectable()
export class PolymarketMarketResolutionService {
  private readonly logger = new Logger(PolymarketMarketResolutionService.name);

  constructor(
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectQueue(WALLET_ANALYTICS_QUEUE_NAME)
    private readonly walletAnalyticsQueue: Queue<WalletRecalculateJob>,
  ) {}

  /**
   * Обновляет маркет по событию WS `market_resolved` и ставит пересчёт кошельков трейдеров.
   */
  async applyMarketResolvedFromWs(input: {
    conditionId: string;
    winningAssetId: string;
    winningOutcome: string;
  }): Promise<void> {
    const conditionId = input.conditionId.trim();
    const winningAssetId = input.winningAssetId.trim();
    if (conditionId.length === 0 || winningAssetId.length === 0) {
      return;
    }
    const outcome = input.winningOutcome.trim();

    const result = await this.marketRepository
      .createQueryBuilder()
      .update(Market)
      .set({
        closed: true,
        active: false,
        winning_token_id: winningAssetId,
        winning_outcome: outcome.length > 0 ? outcome : null,
      })
      .where("condition_id = :cid", { cid: conditionId })
      .execute();

    if (result.affected === 0) {
      this.logger.warn(
        `market_resolved: маркет ${conditionId} не найден в БД, пересчёт кошельков пропущен`,
      );
      return;
    }

    await this.enqueueWalletRecalcForMarketTraders(conditionId);
  }

  /** Уникальные maker_address по сделкам маркета — джобы wallet-recalculate. */
  async enqueueWalletRecalcForMarketTraders(conditionId: string): Promise<void> {
    const cid = conditionId.trim();
    if (cid.length === 0) {
      return;
    }
    const rows = await this.tradeRepository
      .createQueryBuilder("t")
      .select("DISTINCT t.maker_address", "maker_address")
      .where("t.market = :m", { m: cid })
      .getRawMany<{ maker_address: string }>();

    for (const row of rows) {
      const address = row.maker_address?.trim();
      if (address === undefined || address.length === 0) {
        continue;
      }
      await this.walletAnalyticsQueue.add(
        WALLET_ANALYTICS_JOB_RECALCULATE,
        { address },
        { jobId: `wallet-recalculate:${address}` },
      );
    }
  }
}
