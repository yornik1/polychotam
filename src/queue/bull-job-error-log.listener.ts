import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, QueueEvents } from "bullmq";
import { buildBullMqConnection } from "../config/bullmq.config.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import {
  TRADE_ENRICHMENT_QUEUE_NAME,
  TRADES_QUEUE_NAME,
  WALLET_ANALYTICS_QUEUE_NAME,
} from "./trades-queue.config.js";

/** Совпадает с префиксом ключей Redis по умолчанию в BullMQ / Nest. */
const BULLMQ_KEY_PREFIX = "bull";

type QueueEventKind = "stalled" | "retries-exhausted";

/**
 * Пишет в NDJSON stalled / retries-exhausted из QueueEvents.
 * Исключение из process() логирует BullMQ через @OnWorkerEvent('failed') в процессоре (полный stack).
 * На случай дубля экземпляров модуля — подписка QueueEvents только у первого владельца.
 */
@Injectable()
export class BullJobErrorLogListener implements OnModuleInit, OnModuleDestroy {
  private static activeOwner: BullJobErrorLogListener | null = null;

  private readonly logger = new Logger(BullJobErrorLogListener.name);
  private readonly queueEventsInstances: QueueEvents[] = [];
  private readonly queues: Queue[] = [];
  private iOwnSubscriptions = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly ndjsonLog: BullJobNdjsonLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (BullJobErrorLogListener.activeOwner !== null) {
      return;
    }

    if (!this.ndjsonLog.isEnabled()) {
      this.logger.log("BULL_JOB_ERRORS_LOG_PATH пуст — файл ошибок джобов отключён");
      return;
    }

    BullJobErrorLogListener.activeOwner = this;
    this.iOwnSubscriptions = true;

    const connection = buildBullMqConnection(this.configService);
    const queueNames = [
      TRADES_QUEUE_NAME,
      WALLET_ANALYTICS_QUEUE_NAME,
      TRADE_ENRICHMENT_QUEUE_NAME,
    ] as const;

    for (const queueName of queueNames) {
      const queue = new Queue(queueName, {
        connection,
        prefix: BULLMQ_KEY_PREFIX,
      });
      const queueEvents = new QueueEvents(queueName, {
        connection,
        prefix: BULLMQ_KEY_PREFIX,
      });
      this.queues.push(queue);
      this.queueEventsInstances.push(queueEvents);
      await queueEvents.waitUntilReady();

      queueEvents.on("stalled", (args: { jobId: string }) => {
        void this.writeJobEvent(queueName, "stalled", args.jobId, queue, {
          failedReason: "job stalled (lock не продлён вовремя)",
        });
      });

      queueEvents.on(
        "retries-exhausted",
        (args: { jobId: string; attemptsMade: string }) => {
          void this.writeJobEvent(
            queueName,
            "retries-exhausted",
            args.jobId,
            queue,
            {
              failedReason: `retries exhausted (attemptsMade=${args.attemptsMade})`,
              attemptsMadeFromEvent: args.attemptsMade,
            },
          );
        },
      );
    }

    this.logger.log(
      `QueueEvents → NDJSON: ${this.ndjsonLog.getAbsolutePath()} (prefix=${BULLMQ_KEY_PREFIX})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.iOwnSubscriptions) {
      return;
    }
    this.iOwnSubscriptions = false;
    if (BullJobErrorLogListener.activeOwner === this) {
      BullJobErrorLogListener.activeOwner = null;
    }
    await Promise.all([
      ...this.queueEventsInstances.map((instance) => instance.close()),
      ...this.queues.map((queue) => queue.close()),
    ]);
  }

  private writeJobEvent(
    queueName: string,
    eventKind: QueueEventKind,
    jobId: string,
    queue: Queue,
    extra: {
      failedReason: string;
      prev?: string;
      attemptsMadeFromEvent?: string;
    },
  ): void {
    if (!this.ndjsonLog.isEnabled()) {
      return;
    }

    void (async () => {
      let jobName: string | undefined;
      let attemptsMade: number | undefined;
      let maxAttempts: number | undefined;
      let data: unknown;
      let stacktrace: string[] | undefined;
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          jobName = job.name;
          attemptsMade = job.attemptsMade;
          const attemptsOpt = job.opts.attempts;
          maxAttempts =
            typeof attemptsOpt === "number" ? attemptsOpt : undefined;
          data = job.data;
          stacktrace = job.stacktrace;
        }
      } catch {
        // getJob может не сработать
      }

      const failedReason = extra.failedReason;
      this.ndjsonLog.append({
        eventType: eventKind,
        queue: queueName,
        jobId,
        jobName,
        message: failedReason,
        failedReason,
        prev: extra.prev,
        attemptsMadeFromEvent: extra.attemptsMadeFromEvent,
        attemptsMade,
        maxAttempts,
        data,
        stacktrace,
        stacktraceJoined:
          stacktrace !== undefined && stacktrace.length > 0
            ? stacktrace.join("\n")
            : undefined,
        oneLine: `[${queueName}] ${eventKind} id=${jobId}: ${failedReason}`,
      });
    })().catch((error: unknown) => {
      this.logger.error(
        `Сбор данных для NDJSON не удался: ${String(error)}`,
      );
    });
  }
}
