import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { parseBoolean, parsePositiveInt } from "../refresh-smart-wallets.cli.util.js";
import { Trade } from "../trades/trade.entity.js";

/** Дефолты ретеншена: возраст хвоста, размер батча, потолок батчей за тик. */
const DEFAULT_RETENTION_DAYS = 2;
const DEFAULT_BATCH_SIZE = 5000;
const DEFAULT_MAX_BATCHES_PER_RUN = 40;

export interface UnknownTradeCleanupResult {
  readonly deleted: number;
  readonly batches: number;
  readonly drained: boolean;
  readonly skipped?: "disabled";
}

/**
 * Ретеншен мёртвого хвоста live WS-строк (`status='RECORDED_WS'`,
 * `maker_address='unknown'`): по крону батчами удаляет те, что не получили
 * реального maker за `TRADE_UNKNOWN_RETENTION_DAYS` дней. Такие строки не
 * атрибутируются ни на один кошелёк (аналитика их исключает) и Data API их уже
 * не отдаёт, поэтому это безвозвратный балласт. Каждый батч — отдельная
 * транзакция (через bounded `LIMIT`-подзапрос), чтобы не держать долгий лок и
 * не пухнуть единой гигантской транзакцией.
 */
@Injectable()
export class UnknownTradeCleanupService {
  private readonly logger = new Logger(UnknownTradeCleanupService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly configService: ConfigService,
  ) {}

  /** Раз в час подчищаем просроченный unknown-хвост, если включено. */
  @Cron("0 7 * * * *")
  async cleanupScheduled(): Promise<void> {
    try {
      const result = await this.cleanupBatch();
      if (result.deleted > 0) {
        this.logger.log(
          `Cleanup unknown-хвоста: удалено ${result.deleted} строк за ${result.batches} батчей` +
            (result.drained ? " (дренирован)" : " (упёрлись в потолок за тик)"),
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.warn(`Cleanup unknown-хвоста: ${message}`);
    }
  }

  async cleanupBatch(): Promise<UnknownTradeCleanupResult> {
    if (!this.isEnabled()) {
      return { deleted: 0, batches: 0, drained: false, skipped: "disabled" };
    }

    const retentionDays = this.readPositiveInt(
      "TRADE_UNKNOWN_RETENTION_DAYS",
      DEFAULT_RETENTION_DAYS,
    );
    const batchSize = this.readPositiveInt(
      "TRADE_UNKNOWN_CLEANUP_BATCH_SIZE",
      DEFAULT_BATCH_SIZE,
    );
    const maxBatches = this.readPositiveInt(
      "TRADE_UNKNOWN_CLEANUP_MAX_BATCHES",
      DEFAULT_MAX_BATCHES_PER_RUN,
    );

    let deleted = 0;
    let batches = 0;
    for (let i = 0; i < maxBatches; i += 1) {
      const removed = await this.deleteExpiredChunk(retentionDays, batchSize);
      deleted += removed;
      batches += 1;
      // Неполный батч — хвост исчерпан, лишний пустой round-trip не нужен.
      if (removed < batchSize) {
        return { deleted, batches, drained: true };
      }
    }
    return { deleted, batches, drained: false };
  }

  private async deleteExpiredChunk(
    retentionDays: number,
    batchSize: number,
  ): Promise<number> {
    // Postgres DELETE не поддерживает LIMIT напрямую — режем по подзапросу id.
    const result = await this.tradeRepository
      .createQueryBuilder()
      .delete()
      .from(Trade)
      .where(
        `id IN (
          SELECT id FROM trades
          WHERE status = 'RECORDED_WS'
            AND maker_address = 'unknown'
            AND match_time < now() - (:retentionDays * interval '1 day')
          LIMIT :batchSize
        )`,
        { retentionDays, batchSize },
      )
      .execute();
    return result.affected ?? 0;
  }

  private isEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>("TRADE_UNKNOWN_CLEANUP_ENABLED"),
      false,
      "TRADE_UNKNOWN_CLEANUP_ENABLED",
    );
  }

  private readPositiveInt(key: string, fallback: number): number {
    return parsePositiveInt(this.configService.get<string>(key), fallback, key) ?? fallback;
  }
}
