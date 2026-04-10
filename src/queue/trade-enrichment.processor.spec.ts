import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { TradeEnrichmentJob } from "../types/contracts.js";
import { LiveTradeEnricherService } from "../polymarket/live-trade-enricher.service.js";
import { TradesService } from "../trades/trades.service.js";
import { TradeAlertService } from "../telegram/trade-alert.service.js";
import {
  TRADE_ENRICHMENT_JOB_PROCESS,
} from "./trades-queue.config.js";
import { TradeEnrichmentProcessor } from "./trade-enrichment.processor.js";

function jobStub(
  name: string,
  data: TradeEnrichmentJob,
): Pick<Job<TradeEnrichmentJob>, "name" | "data"> {
  return { name, data };
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
    });
  });

  it("бросает ошибку, если enrichment не нашёл адрес", async () => {
    const findMakerAddress = vi.fn().mockResolvedValue(null);
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);
    const maybeSendTradeAlert = vi.fn().mockResolvedValue(false);

    const processor = new TradeEnrichmentProcessor(
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
      { maybeSendTradeAlert } as unknown as TradeAlertService,
    );

    await expect(
      processor.process(
        jobStub(TRADE_ENRICHMENT_JOB_PROCESS, createJob()) as Job<TradeEnrichmentJob>,
      ),
    ).rejects.toThrow(/maker address/i);

    expect(updateMakerAddress).not.toHaveBeenCalled();
    expect(maybeSendTradeAlert).not.toHaveBeenCalled();
  });
});
