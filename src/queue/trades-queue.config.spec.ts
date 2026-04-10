import { describe, expect, it } from "vitest";
import {
  TRADES_JOB_PROCESS,
  TRADES_QUEUE_NAME,
  tradesQueueRegisterOptions,
} from "./trades-queue.config.js";

describe("trades-queue.config", () => {
  it("имя очереди и job совпадают с ожиданиями DoD", () => {
    expect(TRADES_QUEUE_NAME).toBe("trades");
    expect(TRADES_JOB_PROCESS).toBe("process-trade");
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
});
