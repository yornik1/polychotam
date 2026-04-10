import { describe, expect, it } from "vitest";
import {
  TRADES_JOB_PROCESS,
  TRADES_QUEUE_NAME,
  tradesQueueRegisterOptions,
  WALLET_ANALYTICS_JOB_RECALCULATE,
  WALLET_ANALYTICS_QUEUE_NAME,
  walletAnalyticsQueueRegisterOptions,
} from "./trades-queue.config.js";

describe("trades-queue.config", () => {
  it("имя очереди и job совпадают с ожиданиями DoD", () => {
    expect(TRADES_QUEUE_NAME).toBe("trades");
    expect(TRADES_JOB_PROCESS).toBe("process-trade");
    expect(WALLET_ANALYTICS_QUEUE_NAME).toBe("wallet-analytics");
    expect(WALLET_ANALYTICS_JOB_RECALCULATE).toBe("wallet-recalculate");
  });

  it("регистрация очереди задаёт retry 3× exponential", () => {
    expect(tradesQueueRegisterOptions).toMatchObject({
      name: "trades",
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  });

  it("wallet analytics очередь использует тот же retry профиль", () => {
    expect(walletAnalyticsQueueRegisterOptions).toMatchObject({
      name: "wallet-analytics",
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 5000,
      },
    });
  });
});
