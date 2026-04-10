import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { TradesService } from "../trades/trades.service.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
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
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
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
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });

  it("сохраняет сделку и не ставит пересчёт при пустых wallet owner makerAddress", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
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
    expect(addEnrichment).toHaveBeenCalledWith(
      TRADE_ENRICHMENT_JOB_PROCESS,
      expect.objectContaining({
        tradeRecordId: expect.stringMatching(/^ws:/),
        market: "0xm",
        assetId: "a1",
        amount: "1",
        price: "0.5",
        side: "SELL",
        timestamp: 1,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^trade-enrichment:/),
      }),
    );
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });

  it("ставит recalculation job с приоритетом makerAddress над wallet и owner", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(true);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
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
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).toHaveBeenCalledWith({
      address: "0xmaker",
      market: "0xm",
      side: "BUY",
      amount: "1",
    });
  });

  it("если makerAddress пустой, берёт wallet до owner чтобы совпасть с trades.maker_address", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(true);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
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
      makerAddress: "   ",
    };

    await processor.process(
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent>,
    );

    expect(add).toHaveBeenCalledWith(
      WALLET_ANALYTICS_JOB_RECALCULATE,
      { address: "0xwallet" },
      { jobId: "wallet-recalculate:0xwallet" },
    );
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).toHaveBeenCalledWith({
      address: "0xwallet",
      market: "0xm",
      side: "BUY",
      amount: "1",
    });
  });

  it("бросает при TRADES_PROCESSOR_THROW=true (проверка failed в Bull Board)", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const config = {
      get: vi.fn().mockReturnValue("true"),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      { saveFromWsTradeEvent: saveFromWs } as unknown as TradesService,
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
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
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });
});
