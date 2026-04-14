import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { resolveBullJobErrorsLogPathRaw } from "./bull-job-error-log.env.js";

/**
 * Общая запись NDJSON для BullJobErrorLogListener и процессоров.
 * «Тихий» return без throw в BullMQ не даёт события failed — пишем сами.
 */
@Injectable()
export class BullJobNdjsonLogService {
  private readonly logger = new Logger(BullJobNdjsonLogService.name);
  private readonly absolutePath: string | null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(configService: ConfigService) {
    const configured = resolveBullJobErrorsLogPathRaw(
      configService.get<string>("BULL_JOB_ERRORS_LOG_PATH"),
    );
    if (configured === "") {
      this.absolutePath = null;
      return;
    }
    const relativeOrAbsolute =
      configured ?? "logs/bull-job-errors.ndjson";
    this.absolutePath = isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : join(process.cwd(), relativeOrAbsolute);
  }

  isEnabled(): boolean {
    return this.absolutePath !== null;
  }

  getAbsolutePath(): string | null {
    return this.absolutePath;
  }

  /**
   * Падение джоба в воркере BullMQ: полный Error.message и stack (для отладки).
   * Событие QueueEvents «failed» даёт только строку failedReason и гоняется с getJob.
   */
  logWorkerFailed(
    queueName: string,
    job: Job | undefined,
    error: Error,
    prev: string,
  ): void {
    const jobId = job?.id ?? "(нет job — см. stalled/removeOnFail)";
    const jobName = job?.name ?? "?";
    const msg = error.message;
    this.append({
      eventType: "worker_failed",
      queue: queueName,
      jobId: job?.id,
      jobName: job?.name,
      message: msg,
      failedReason: msg,
      stack: error.stack ?? null,
      prev,
      data: job?.data,
      attemptsMade: job?.attemptsMade,
      maxAttempts:
        job !== undefined && typeof job.opts?.attempts === "number"
          ? job.opts.attempts
          : undefined,
      oneLine: `[${queueName}] ${jobName} id=${jobId}: ${msg}`,
    });
  }

  /**
   * Дописывает одну строку NDJSON (ts добавляется автоматически).
   */
  append(record: Record<string, unknown>): void {
    if (this.absolutePath === null) {
      return;
    }

    const path = this.absolutePath;
    const line = `${JSON.stringify({
      ...record,
      ts: new Date().toISOString(),
    })}\n`;

    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, line, "utf8");
      })
      .catch((error: unknown) => {
        this.logger.error(
          `NDJSON лог джобов: запись не удалась: ${String(error)}`,
        );
      });
  }
}
