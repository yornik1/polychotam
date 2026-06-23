import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { parseBoolean, parsePositiveInt } from "../refresh-smart-wallets.cli.util.js";
import {
  UnknownTradeRepairService,
  type UnknownTradeRepairOrder,
} from "../trades/unknown-trade-repair.service.js";
import {
  TRADE_ENRICHMENT_JOB_ID_PREFIX,
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
  tradesDerivedJobId,
} from "./trades-queue.config.js";

/** Дефолты фидера: размер батча, watermark backlog'а очереди. */
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_QUEUE_WATERMARK = 100;
/** Backfill идёт ниже live: ненулевой priority пропускает вперёд live-джобы (priority 0). */
const BACKFILL_PRIORITY = 100;

export interface UnknownTradeBackfillFeedResult {
  readonly enqueued: number;
  readonly skipped?: "disabled" | "busy" | "empty";
  readonly backlog?: number;
}

/**
 * Фоновый фидер ремонта старых `maker_address='unknown'`: по крону выбирает
 * bounded whale-first батч и кладёт его low-priority джобами в ту же
 * `trade-enrichment` очередь. Backfill и live делят один Redis-лимитер и
 * exponential backoff воркера; live обслуживается первым по priority. Чтобы не
 * флудить Redis, тик кладёт батч только когда backlog очереди ниже watermark.
 */
@Injectable()
export class UnknownTradeBackfillFeederService {
  private readonly logger = new Logger(UnknownTradeBackfillFeederService.name);

  constructor(
    @InjectQueue(TRADE_ENRICHMENT_QUEUE_NAME)
    private readonly tradeEnrichmentQueue: Queue,
    private readonly unknownTradeRepairService: UnknownTradeRepairService,
    private readonly configService: ConfigService,
  ) {}

  /** Каждые 2 минуты подкидываем восстановимые unknown, если очередь свободна. */
  @Cron("30 */2 * * * *")
  async feedScheduled(): Promise<void> {
    try {
      const result = await this.feedBatch();
      if (result.enqueued > 0) {
        this.logger.log(
          `Backfill-фидер: поставлено ${result.enqueued} unknown-сделок на enrichment`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.warn(`Backfill-фидер: ${message}`);
    }
  }

  async feedBatch(): Promise<UnknownTradeBackfillFeedResult> {
    if (!this.isEnabled()) {
      return { enqueued: 0, skipped: "disabled" };
    }

    const watermark = this.readPositiveInt(
      "TRADE_BACKFILL_QUEUE_WATERMARK",
      DEFAULT_QUEUE_WATERMARK,
    );
    const backlog = await this.queueBacklog();
    if (backlog >= watermark) {
      return { enqueued: 0, skipped: "busy", backlog };
    }

    const batchSize = this.readPositiveInt(
      "TRADE_BACKFILL_BATCH_SIZE",
      DEFAULT_BATCH_SIZE,
    );
    const jobs = await this.unknownTradeRepairService.selectUnknownEnrichmentJobs({
      limit: batchSize,
      order: this.readOrder(),
    });
    if (jobs.length === 0) {
      return { enqueued: 0, skipped: "empty" };
    }

    for (const job of jobs) {
      await this.tradeEnrichmentQueue.add(TRADE_ENRICHMENT_JOB_PROCESS, job, {
        jobId: tradesDerivedJobId(TRADE_ENRICHMENT_JOB_ID_PREFIX, job.tradeRecordId),
        priority: BACKFILL_PRIORITY,
      });
    }

    return { enqueued: jobs.length };
  }

  private async queueBacklog(): Promise<number> {
    const counts = await this.tradeEnrichmentQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "prioritized",
    );
    return (
      (counts.waiting ?? 0) +
      (counts.active ?? 0) +
      (counts.delayed ?? 0) +
      (counts.prioritized ?? 0)
    );
  }

  private isEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>("TRADE_BACKFILL_ENABLED"),
      false,
      "TRADE_BACKFILL_ENABLED",
    );
  }

  private readOrder(): UnknownTradeRepairOrder {
    return this.configService.get<string>("TRADE_BACKFILL_ORDER") === "recent"
      ? "recent"
      : "whale";
  }

  private readPositiveInt(key: string, fallback: number): number {
    return parsePositiveInt(this.configService.get<string>(key), fallback, key) ?? fallback;
  }
}
