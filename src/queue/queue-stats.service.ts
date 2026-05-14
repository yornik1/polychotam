import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { readFile, stat } from "node:fs/promises";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import {
  TRADE_ENRICHMENT_QUEUE_NAME,
  TRADES_QUEUE_NAME,
  WALLET_ANALYTICS_QUEUE_NAME,
} from "./trades-queue.config.js";

export interface QueueCountsRow {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export interface NdjsonErrorRow {
  ts: string;
  queue?: string;
  jobName?: string;
  message?: string;
  eventType?: string;
}

/**
 * Агрегатор для TG-команд /queues и /errors.
 * NDJSON читаем хвостом файла, чтобы не тянуть гигабайт в память.
 */
@Injectable()
export class QueueStatsService {
  private readonly logger = new Logger(QueueStatsService.name);
  /** Сколько байт хвоста читать из NDJSON за раз. */
  private static readonly TAIL_BYTES = 64 * 1024;

  constructor(
    @InjectQueue(TRADES_QUEUE_NAME)
    private readonly tradesQueue: Queue,
    @InjectQueue(WALLET_ANALYTICS_QUEUE_NAME)
    private readonly walletAnalyticsQueue: Queue,
    @InjectQueue(TRADE_ENRICHMENT_QUEUE_NAME)
    private readonly tradeEnrichmentQueue: Queue,
    private readonly ndjsonLog: BullJobNdjsonLogService,
  ) {}

  async getAllQueueCounts(): Promise<QueueCountsRow[]> {
    const queues: Array<{ name: string; queue: Queue }> = [
      { name: TRADES_QUEUE_NAME, queue: this.tradesQueue },
      { name: WALLET_ANALYTICS_QUEUE_NAME, queue: this.walletAnalyticsQueue },
      { name: TRADE_ENRICHMENT_QUEUE_NAME, queue: this.tradeEnrichmentQueue },
    ];

    const results = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "failed",
          "completed",
        );
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        };
      }),
    );

    return results;
  }

  /**
   * Читает последние ~limit записей NDJSON с конца файла.
   * Возвращает {entries, totalLineCountInTail} — totalLineCount это нижняя оценка.
   */
  async getRecentErrors(
    limit = 10,
  ): Promise<{ entries: NdjsonErrorRow[]; totalInTail: number }> {
    const path = this.ndjsonLog.getAbsolutePath();
    if (path === null) {
      return { entries: [], totalInTail: 0 };
    }

    let fileSize: number;
    try {
      const stats = await stat(path);
      fileSize = stats.size;
    } catch {
      return { entries: [], totalInTail: 0 };
    }

    if (fileSize === 0) {
      return { entries: [], totalInTail: 0 };
    }

    // Читаем хвост файла (Node fs нет ReadStream для tail, читаем последние N байт через fd).
    const startByte = Math.max(0, fileSize - QueueStatsService.TAIL_BYTES);
    let buffer: Buffer;
    try {
      const fileContent = await readFile(path);
      buffer = fileContent.subarray(startByte);
    } catch (error: unknown) {
      this.logger.error(`Не удалось прочитать NDJSON: ${String(error)}`);
      return { entries: [], totalInTail: 0 };
    }

    const text = buffer.toString("utf8");
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Если читали с середины файла — первая строка может быть оборвана, выкидываем
    const safeLines = startByte > 0 ? lines.slice(1) : lines;

    const parsed: NdjsonErrorRow[] = [];
    for (const line of safeLines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        parsed.push({
          ts: typeof obj.ts === "string" ? obj.ts : "",
          queue: typeof obj.queue === "string" ? obj.queue : undefined,
          jobName: typeof obj.jobName === "string" ? obj.jobName : undefined,
          message: typeof obj.message === "string" ? obj.message : undefined,
          eventType:
            typeof obj.eventType === "string" ? obj.eventType : undefined,
        });
      } catch {
        // битая строка — пропускаем
      }
    }

    const recent = parsed.slice(-limit);
    return { entries: recent, totalInTail: parsed.length };
  }
}
