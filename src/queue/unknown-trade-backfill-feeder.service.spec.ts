import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { getQueueToken } from "@nestjs/bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeEnrichmentJob } from "../types/contracts.js";
import { UnknownTradeRepairService } from "../trades/unknown-trade-repair.service.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
  TRADE_ENRICHMENT_QUEUE_NAME,
} from "./trades-queue.config.js";
import { UnknownTradeBackfillFeederService } from "./unknown-trade-backfill-feeder.service.js";

function buildJob(id: string): TradeEnrichmentJob {
  return {
    tradeRecordId: id,
    market: "0xmarket",
    assetId: "0xasset",
    side: "BUY",
    amount: "1000",
    price: "0.5",
    timestamp: 1_700_000_000,
    backfill: true,
  };
}

describe("UnknownTradeBackfillFeederService", () => {
  const queueAdd = vi.fn();
  const queueGetJobCounts = vi.fn();
  const selectUnknownEnrichmentJobs = vi.fn();
  const config = new Map<string, string>();

  async function build(): Promise<UnknownTradeBackfillFeederService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UnknownTradeBackfillFeederService,
        {
          provide: getQueueToken(TRADE_ENRICHMENT_QUEUE_NAME),
          useValue: { add: queueAdd, getJobCounts: queueGetJobCounts },
        },
        {
          provide: UnknownTradeRepairService,
          useValue: { selectUnknownEnrichmentJobs },
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config.get(key) },
        },
      ],
    }).compile();
    return moduleRef.get(UnknownTradeBackfillFeederService);
  }

  beforeEach(() => {
    queueAdd.mockReset().mockResolvedValue(undefined);
    queueGetJobCounts.mockReset().mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      prioritized: 0,
    });
    selectUnknownEnrichmentJobs.mockReset();
    config.clear();
    config.set("TRADE_BACKFILL_ENABLED", "true");
  });

  it("по умолчанию выключен — ничего не делает", async () => {
    config.delete("TRADE_BACKFILL_ENABLED");
    const service = await build();

    const result = await service.feedBatch();

    expect(result.skipped).toBe("disabled");
    expect(selectUnknownEnrichmentJobs).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("не флудит: пропускает тик, если backlog очереди выше watermark", async () => {
    config.set("TRADE_BACKFILL_QUEUE_WATERMARK", "100");
    queueGetJobCounts.mockResolvedValue({
      waiting: 80,
      active: 2,
      delayed: 0,
      prioritized: 50,
    });
    const service = await build();

    const result = await service.feedBatch();

    expect(result.skipped).toBe("busy");
    expect(result.backlog).toBe(132);
    expect(selectUnknownEnrichmentJobs).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("ставит backfill-джобы low-priority, когда очередь почти пуста", async () => {
    config.set("TRADE_BACKFILL_BATCH_SIZE", "2");
    config.set("TRADE_BACKFILL_ORDER", "whale");
    selectUnknownEnrichmentJobs.mockResolvedValue([buildJob("a"), buildJob("b")]);
    const service = await build();

    const result = await service.feedBatch();

    expect(selectUnknownEnrichmentJobs).toHaveBeenCalledWith({
      limit: 2,
      order: "whale",
    });
    expect(result.enqueued).toBe(2);
    expect(queueAdd).toHaveBeenCalledTimes(2);
    const [name, data, opts] = queueAdd.mock.calls[0] as [
      string,
      TradeEnrichmentJob,
      { jobId: string; priority: number },
    ];
    expect(name).toBe(TRADE_ENRICHMENT_JOB_PROCESS);
    expect(data.backfill).toBe(true);
    expect(opts.jobId).toBe("trade-enrichment-a");
    expect(opts.priority).toBeGreaterThan(0);
  });

  it("ничего не ставит, если восстановимых unknown не осталось", async () => {
    selectUnknownEnrichmentJobs.mockResolvedValue([]);
    const service = await build();

    const result = await service.feedBatch();

    expect(result.skipped).toBe("empty");
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
