import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { TradeEnrichmentJob } from "../types/contracts.js";
import { LiveTradeEnricherService } from "../polymarket/live-trade-enricher.service.js";
import { TradesService } from "../trades/trades.service.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
} from "./trades-queue.config.js";
import { TradeEnrichmentProcessor } from "./trade-enrichment.processor.js";

function jobStub(
  name: string,
  data: TradeEnrichmentJob,
  overrides: {
    attemptsMade?: number;
    opts?: { attempts?: number };
    id?: string;
  } = {},
): Pick<Job<TradeEnrichmentJob>, "id" | "name" | "data" | "attemptsMade" | "opts"> {
  return {
    id: overrides.id ?? "test-enrich-job-id",
    name,
    data,
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: overrides.opts ?? { attempts: 3 },
  };
}

function stubNdjsonLog(): BullJobNdjsonLogService {
  return {
    append: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(true),
    getAbsolutePath: vi.fn().mockReturnValue("/tmp/bull-job-errors.ndjson"),
    logWorkerFailed: vi.fn(),
  } as unknown as BullJobNdjsonLogService;
}

describe("TradeEnrichmentProcessor", () => {
  function createJob(): TradeEnrichmentJob {
    return {
      tradeRecordId: "ws:trade-1",
      market: "0xmarket",
      assetId: "asset-1",
      side: "BUY",
      amount: "219.217767",
      price: "0.456",
      timestamp: 1700000000000,
    };
  }

  it("обновляет maker_address, если enrichment нашёл адрес", async () => {
    const findMakerAddress = vi.fn().mockResolvedValue("0xmaker");
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(true);

    const processor = new TradeEnrichmentProcessor(
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      stubNdjsonLog(),
    );

    await processor.process(
      jobStub(TRADE_ENRICHMENT_JOB_PROCESS, createJob()) as Job<TradeEnrichmentJob>,
    );

    expect(findMakerAddress).toHaveBeenCalledWith(createJob());
    expect(updateMakerAddress).toHaveBeenCalledWith("ws:trade-1", "0xmaker");
    expect(maybeSendTradeAlert).toHaveBeenCalledWith({
      address: "0xmaker",
      market: "0xmarket",
      side: "BUY",
      amount: "219.217767",
      tradeTimestamp: 1700000000000,
    });
  });

  it("бросает ошибку для ретрая, если не последняя попытка", async () => {
    const findMakerAddress = vi.fn().mockResolvedValue(null);
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);

    const processor = new TradeEnrichmentProcessor(
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      stubNdjsonLog(),
    );

    await expect(
      processor.process(
        jobStub(TRADE_ENRICHMENT_JOB_PROCESS, createJob(), {
          attemptsMade: 0,
          opts: { attempts: 3 },
        }) as Job<TradeEnrichmentJob>,
      ),
    ).rejects.toThrow(/maker address/i);

    expect(updateMakerAddress).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });

  it("на последней попытке не пишет ожидаемый miss в error NDJSON", async () => {
    const findMakerAddress = vi.fn().mockResolvedValue(null);
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);
    const ndjson = stubNdjsonLog();

    const processor = new TradeEnrichmentProcessor(
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
      ndjson,
    );

    await expect(
      processor.process(
        jobStub(TRADE_ENRICHMENT_JOB_PROCESS, createJob(), {
          attemptsMade: 2,
          opts: { attempts: 3 },
        }) as Job<TradeEnrichmentJob>,
      ),
    ).resolves.toBeUndefined();

    expect(updateMakerAddress).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
    expect(ndjson.append).not.toHaveBeenCalled();
  });

  it("onWorkerFailed не логирует промежуточный ретрай", () => {
    const ndjson = stubNdjsonLog();
    const processor = new TradeEnrichmentProcessor(
      {} as unknown as LiveTradeEnricherService,
      {} as unknown as TradesService,
      {} as unknown as TradeAlertService,
      ndjson,
    );
    const err = new Error("Trade enrichment did not find maker address");
    processor.onWorkerFailed(
      jobStub(TRADE_ENRICHMENT_JOB_PROCESS, createJob(), {
        attemptsMade: 1,
        opts: { attempts: 3 },
      }) as Job<TradeEnrichmentJob>,
      err,
      "prev",
    );
    expect(ndjson.logWorkerFailed).not.toHaveBeenCalled();
  });

  it("onWorkerFailed логирует финальное падение воркера", () => {
    const ndjson = stubNdjsonLog();
    const processor = new TradeEnrichmentProcessor(
      {} as unknown as LiveTradeEnricherService,
      {} as unknown as TradesService,
      {} as unknown as TradeAlertService,
      ndjson,
    );
    const err = new Error("unexpected");
    const job = jobStub(TRADE_ENRICHMENT_JOB_PROCESS, createJob(), {
      attemptsMade: 3,
      opts: { attempts: 3 },
    }) as Job<TradeEnrichmentJob>;
    processor.onWorkerFailed(job, err, "prev");
    expect(ndjson.logWorkerFailed).toHaveBeenCalledWith(
      TRADE_ENRICHMENT_QUEUE_NAME,
      job,
      err,
      "prev",
    );
  });
});
