/** Имя очереди BullMQ для сделок из WebSocket (ключи Redis: `bull:trades:...`). */
export const TRADES_QUEUE_NAME = "trades";
export const WALLET_ANALYTICS_QUEUE_NAME = "wallet-analytics";
export const TRADE_ENRICHMENT_QUEUE_NAME = "trade-enrichment";

/** Имя job внутри очереди `trades`. */
export const TRADES_JOB_PROCESS = "process-trade";
export const TRADES_JOB_BACKFILL_PAGE = "backfill-page";
export const WALLET_ANALYTICS_JOB_RECALCULATE = "wallet-recalculate";
export const WALLET_ANALYTICS_JOB_PNL_RECALC = "wallet-pnl-recalc";
export const TRADE_ENRICHMENT_JOB_PROCESS = "enrich-trade";

/** Префикс пользовательского jobId для enrichment (имя job — `enrich-trade`). */
export const TRADE_ENRICHMENT_JOB_ID_PREFIX = "trade-enrichment";

/**
 * BullMQ не допускает двоеточие в пользовательском jobId (Job.validateOptions).
 * Коалесцирование сохраняем: `ws:hash` → `ws-hash`, адрес без изменений.
 */
export function tradesDerivedJobId(prefix: string, uniqueKey: string): string {
  const safe = uniqueKey.trim().replace(/:/g, "-");
  return `${prefix}-${safe}`;
}

/** Регистрация очереди + retry по умолчанию (DoD: 3 попытки, exponential backoff). */
export const tradesQueueRegisterOptions = {
  name: TRADES_QUEUE_NAME,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
    // Для WS-потока храним только ограниченную историю job-ов, чтобы Redis не рос бесконечно.
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
} as const;

export const walletAnalyticsQueueRegisterOptions = {
  name: WALLET_ANALYTICS_QUEUE_NAME,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
    // Идентичный jobId нужен для коалесцирования адресов, поэтому completed job удаляем сразу.
    removeOnComplete: true,
    removeOnFail: 5000,
  },
} as const;

export const tradeEnrichmentQueueRegisterOptions = {
  name: TRADE_ENRICHMENT_QUEUE_NAME,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 10000 },
    // Иначе «тихий» return после исчерпания попыток (maker не найден) сразу исчезает из Bull Board.
    removeOnComplete: 200,
    removeOnFail: 5000,
  },
} as const;

/** BullMQ: тяжёлые джобы (recalculate, HTTP enrichment) не должны помечаться stalled. */
export const TRADES_WORKER_OPTIONS = {
  lockDuration: 300_000,
  limiter: { max: 50, duration: 1000 },
} as const;

export const WALLET_ANALYTICS_WORKER_OPTIONS = {
  lockDuration: 300_000,
  concurrency: 2,
  limiter: { max: 8, duration: 1000 },
} as const;

export const TRADE_ENRICHMENT_WORKER_OPTIONS = {
  lockDuration: 240_000,
  concurrency: 2,
  limiter: { max: 5, duration: 1000 },
} as const;
