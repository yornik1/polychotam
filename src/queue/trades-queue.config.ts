/** Имя очереди BullMQ для сделок из WebSocket (ключи Redis: `bull:trades:...`). */
export const TRADES_QUEUE_NAME = "trades";
export const WALLET_ANALYTICS_QUEUE_NAME = "wallet-analytics";
export const TRADE_ENRICHMENT_QUEUE_NAME = "trade-enrichment";

/** Имя job внутри очереди `trades`. */
export const TRADES_JOB_PROCESS = "process-trade";
export const TRADES_JOB_BACKFILL_PAGE = "backfill-page";
export const WALLET_ANALYTICS_JOB_RECALCULATE = "wallet-recalculate";
export const TRADE_ENRICHMENT_JOB_PROCESS = "enrich-trade";

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
    removeOnComplete: true,
    removeOnFail: 5000,
  },
} as const;
