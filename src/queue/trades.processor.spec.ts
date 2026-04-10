import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { TradesService } from "../trades/trades.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { TRADES_JOB_PROCESS } from "./trades-queue.config.js";
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
    const upsert = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { upsert } as unknown as WalletsService,
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
    expect(upsert).not.toHaveBeenCalled();
  });

  it("сохраняет сделку и не дергает wallets при пустом wallet", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { upsert } as unknown as WalletsService,
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
    };

    await processor.process(
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent>,
    );

    expect(saveFromWs).toHaveBeenCalledWith(event);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("вызывает upsert кошелька при непустом wallet", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { upsert } as unknown as WalletsService,
      config as ConfigService,
    );

    const event: TradeEvent = {
      wallet: "  0xabc  ",
      amount: "1",
      side: "BUY",
      price: "0.5",
      market: "0xm",
      assetId: "a1",
      timestamp: 1,
    };

    await processor.process(
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent>,
    );

    expect(upsert).toHaveBeenCalledWith({
      address: "0xabc",
      total_won: "0",
      total_lost: "0",
      win_rate: "0",
    });
  });

  it("бросает при TRADES_PROCESSOR_THROW=true (проверка failed в Bull Board)", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue("true"),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { upsert } as unknown as WalletsService,
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
