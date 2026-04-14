import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { BackfillService } from "../polymarket/backfill.service.js";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import type { TradesBackfillPageJob } from "../types/contracts.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { TradesService } from "../trades/trades.service.js";
import {
  TRADE_ENRICHMENT_JOB_ID_PREFIX,
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADES_JOB_BACKFILL_PAGE,
  TRADES_JOB_PROCESS,
  WALLET_ANALYTICS_JOB_RECALCULATE,
} from "./trades-queue.config.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import { TradesProcessor } from "./trades.processor.js";

function jobStub<T>(name: string, data: T): Pick<Job<T>, "name" | "data"> {
  return { name, data };
}

function stubTradesService(
  saveFromWs: ReturnType<typeof vi.fn>,
  enrichPending?: ReturnType<typeof vi.fn>,
): TradesService {
  return {
    saveFromWsTradeEvent: saveFromWs,
    isWsTradePendingEnrichment:
      enrichPending ?? vi.fn().mockResolvedValue(false),
  } as unknown as TradesService;
}

function stubNdjsonLog(): BullJobNdjsonLogService {
  return {
    append: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(false),
    getAbsolutePath: vi.fn().mockReturnValue(null),
    logWorkerFailed: vi.fn(),
  } as unknown as BullJobNdjsonLogService;
}

describe("TradesProcessor", () => {
  it("игнорирует job с чужим именем", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
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
      jobStub("other", event) as Job<TradeEvent | TradesBackfillPageJob>,
    );

    expect(saveFromWs).not.toHaveBeenCalled();
    expect(processBackfillPage).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });

  it("делегирует backfill-page в BackfillService", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
    );

    const payload: TradesBackfillPageJob = {
      conditionId: "0xmarket",
      offset: 500,
    };

    await processor.process(
      jobStub(TRADES_JOB_BACKFILL_PAGE, payload) as Job<
        TradeEvent | TradesBackfillPageJob
      >,
    );

    expect(processBackfillPage).toHaveBeenCalledWith("0xmarket", 500);
    expect(saveFromWs).not.toHaveBeenCalled();
  });

  it("сохраняет сделку и не ставит пересчёт при пустых wallet owner makerAddress", async () => {
    const saveFromWs = vi.fn().mockResolvedValue("inserted_live");
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
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
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent | TradesBackfillPageJob>,
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
        jobId: expect.stringMatching(
          new RegExp(
            `^${TRADE_ENRICHMENT_JOB_ID_PREFIX}-ws-`,
          ),
        ),
      }),
    );
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });

  it("ставит recalculation job с приоритетом makerAddress над wallet и owner", async () => {
    const saveFromWs = vi.fn().mockResolvedValue("inserted_live");
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(true);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
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
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent | TradesBackfillPageJob>,
    );

    expect(add).toHaveBeenCalledWith(
      WALLET_ANALYTICS_JOB_RECALCULATE,
      { address: "0xmaker" },
      { jobId: "wallet-recalculate-0xmaker" },
    );
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).toHaveBeenCalledWith({
      address: "0xmaker",
      market: "0xm",
      side: "BUY",
      amount: "1",
      tradeTimestamp: 1,
    });
  });

  it("если makerAddress пустой, берёт wallet до owner чтобы совпасть с trades.maker_address", async () => {
    const saveFromWs = vi.fn().mockResolvedValue("inserted_live");
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(true);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
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
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent | TradesBackfillPageJob>,
    );

    expect(add).toHaveBeenCalledWith(
      WALLET_ANALYTICS_JOB_RECALCULATE,
      { address: "0xwallet" },
      { jobId: "wallet-recalculate-0xwallet" },
    );
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).toHaveBeenCalledWith({
      address: "0xwallet",
      market: "0xm",
      side: "BUY",
      amount: "1",
      tradeTimestamp: 1,
    });
  });

  it("duplicate_live не шлёт алерт, но ставит enrichment если maker ещё unknown", async () => {
    const saveFromWs = vi.fn().mockResolvedValue("duplicate_live");
    const isWsTradePendingEnrichment = vi.fn().mockResolvedValue(true);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs, isWsTradePendingEnrichment),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "1",
      side: "SELL",
      price: "0.5",
      market: "0xm",
      assetId: "a1",
      timestamp: 99,
    };

    await processor.process(
      jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent | TradesBackfillPageJob>,
    );

    expect(isWsTradePendingEnrichment).toHaveBeenCalled();
    expect(addEnrichment).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });

  it("бросает при TRADES_PROCESSOR_THROW=true (проверка failed в Bull Board)", async () => {
    const saveFromWs = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const addEnrichment = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const processBackfillPage = vi.fn().mockResolvedValue(undefined);
    const config = {
      get: vi.fn().mockReturnValue("true"),
    } as Pick<ConfigService, "get">;

    const processor = new TradesProcessor(
      stubTradesService(saveFromWs),
      { add } as never,
      { add: addEnrichment } as never,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      config as ConfigService,
      { processBackfillPage } as unknown as BackfillService,
      stubNdjsonLog(),
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
      processor.process(
        jobStub(TRADES_JOB_PROCESS, event) as Job<TradeEvent | TradesBackfillPageJob>,
      ),
    ).rejects.toThrow(/TRADES_PROCESSOR_THROW/);

    expect(saveFromWs).not.toHaveBeenCalled();
    expect(addEnrichment).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });
});
