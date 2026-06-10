import { describe, expect, it } from "vitest";
import {
  tradesDerivedJobId,
  TRADES_JOB_PROCESS,
  TRADES_QUEUE_NAME,
  tradesQueueRegisterOptions,
  WALLET_ANALYTICS_JOB_PNL_RECALC,
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
    expect(WALLET_ANALYTICS_JOB_PNL_RECALC).toBe("wallet-pnl-recalc");
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

  it("tradesDerivedJobId не содержит двоеточий (требование BullMQ)", () => {
    expect(tradesDerivedJobId(WALLET_ANALYTICS_JOB_RECALCULATE, "0xabc")).toBe(
      "wallet-recalculate-0xabc",
    );
    expect(tradesDerivedJobId("trade-enrichment", "ws:dead")).toBe(
      "trade-enrichment-ws-dead",
    );
    expect(tradesDerivedJobId("p", "a:b:c")).toBe("p-a-b-c");
  });

  it("jobId для pnl-recalc не содержит двоеточий", () => {
    // Паттерн из QueueService.enqueueWalletPnlRecalc: prefix='pnl', key=address
    const jobId = tradesDerivedJobId("pnl", "0xdeadbeef");
    expect(jobId).toBe("pnl-0xdeadbeef");
    expect(jobId).not.toContain(":");
  });
});
