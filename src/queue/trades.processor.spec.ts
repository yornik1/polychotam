import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { TradesService } from "../trades/trades.service.js";
import {
  TRADES_JOB_PROCESS,
  WALLET_ANALYTICS_JOB_RECALCULATE,
} from "./trades-queue.config.js";
import { TradesProcessor } from "./trades.processor.js";

function jobStub(
  name: string,
  data: TradeEvent,
): Pick<Job<TradeEvent>, "name" | "data"> {
  return { name, data };
}

describe("TradesProcessor", () => {
  it("игнорирует job с чужим именем", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      config as ConfigService,
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "1",
      side: "BUY",
      price: "0.5",
      market: "0xm",
      assetId: "a1",
      timestamp: 1,
    };

    await processor.process(
      jobStub("other", event) as Job<TradeEvent>,
    );

    expect(saveFromWs).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("сохраняет сделку и не ставит пересчёт при пустых wallet owner makerAddress", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      config as ConfigService,
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "1",
      side: "SELL",
      price: "0.5",
      market: "0xm",
      assetId: "a1",
      timestamp: 1,
      owner: "   ",
      makerAddress: "   ",
    };

    await processor.process(
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent>,
    );

    expect(saveFromWs).toHaveBeenCalledWith(event);
    expect(add).not.toHaveBeenCalled();
  });

  it("ставит recalculation job с приоритетом makerAddress над owner и wallet", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      config as ConfigService,
    );

    const event: TradeEvent = {
      wallet: "  0xwallet  ",
      amount: "1",
      side: "BUY",
      price: "0.5",
      market: "0xm",
      assetId: "a1",
      timestamp: 1,
      owner: "  0xowner  ",
      makerAddress: "  0xmaker  ",
    };

    await processor.process(
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent>,
    );

    expect(add).toHaveBeenCalledWith(
      WALLET_ANALYTICS_JOB_RECALCULATE,
      { address: "0xmaker" },
      { jobId: "wallet-recalculate:0xmaker" },
    );
  });

  it("бросает при TRADES_PROCESSOR_THROW=true (проверка failed в Bull Board)", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue("true"),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      config as ConfigService,
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "1",
      side: "BUY",
      price: "0.5",
      market: "0xm",
      assetId: "a1",
      timestamp: 1,
    };

    await expect(
      processor.process(jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent>),
    ).rejects.toThrow(/TRADES_PROCESSOR_THROW/);

    expect(saveFromWs).not.toHaveBeenCalled();
  });
});
