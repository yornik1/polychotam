import { describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import { LiveTradeEnricherService } from "../polymarket/live-trade-enricher.service.js";
import { Trade } from "./trade.entity.js";
import { TradesService } from "./trades.service.js";
import { UnknownTradeRepairService } from "./unknown-trade-repair.service.js";

function createQueryBuilder(rows: unknown[]) {
  const qb = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue(rows),
  };
  return qb;
}

describe("UnknownTradeRepairService", () => {
  it("обновляет только найденные unknown RECORDED_WS сделки и возвращает counters", async () => {
    const rows = [
      {
        id: "ws:1",
        market: "0xmarket",
        asset_id: "asset-1",
        side: "BUY",
        size: "2500",
        price: "0.5",
        match_time: new Date(1_700_000_000_000),
      },
      {
        id: "ws:2",
        market: "0xmarket",
        asset_id: "asset-2",
        side: "SELL",
        size: "10",
        price: "0.2",
        match_time: new Date(1_700_000_010_000),
      },
    ];
    const qb = createQueryBuilder(rows);
    const findMakerAddress = vi
      .fn()
      .mockResolvedValueOnce("0xmaker")
      .mockResolvedValueOnce(null);
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);

    const service = new UnknownTradeRepairService(
      { createQueryBuilder: vi.fn().mockReturnValue(qb) } as unknown as Repository<Trade>,
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
    );

    await expect(service.repairBatch({ limit: 2 })).resolves.toEqual({
      scanned: 2,
      updated: 1,
      missed: 1,
      failed: 0,
    });

    expect(qb.where).toHaveBeenCalledWith("t.status = :status", {
      status: "RECORDED_WS",
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(t.maker_address = :unknown OR t.maker_address = :blank)",
      { unknown: "unknown", blank: "" },
    );
    expect(qb.orderBy).toHaveBeenCalledWith(
      "(t.size::numeric * t.price::numeric)",
      "DESC",
    );
    expect(qb.addOrderBy).toHaveBeenCalledWith("t.id", "ASC");
    expect(qb.limit).toHaveBeenCalledWith(2);
    expect(findMakerAddress).toHaveBeenNthCalledWith(1, {
      tradeRecordId: "ws:1",
      market: "0xmarket",
      assetId: "asset-1",
      side: "BUY",
      amount: "2500",
      price: "0.5",
      timestamp: 1700000000,
    });
    expect(updateMakerAddress).toHaveBeenCalledWith("ws:1", "0xmaker");
    expect(updateMakerAddress).toHaveBeenCalledTimes(1);
  });



  it("изолирует ошибку Data API на строке: считает failed и не обрывает батч", async () => {
    const rows = [
      {
        id: "ws:err",
        market: "0xmarket",
        asset_id: "asset-1",
        side: "BUY",
        size: "5000",
        price: "0.5",
        match_time: new Date(1_700_000_000_000),
      },
      {
        id: "ws:ok",
        market: "0xmarket",
        asset_id: "asset-2",
        side: "SELL",
        size: "2500",
        price: "0.4",
        match_time: new Date(1_700_000_010_000),
      },
    ];
    const findMakerAddress = vi
      .fn()
      .mockRejectedValueOnce(new Error("Trade enrichment request failed: 429"))
      .mockResolvedValueOnce("0xmaker");
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);

    const service = new UnknownTradeRepairService(
      { createQueryBuilder: vi.fn().mockReturnValue(createQueryBuilder(rows)) } as unknown as Repository<Trade>,
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
    );

    await expect(service.repairBatch({ limit: 2 })).resolves.toEqual({
      scanned: 2,
      updated: 1,
      missed: 0,
      failed: 1,
    });
    expect(findMakerAddress).toHaveBeenCalledTimes(2);
    expect(updateMakerAddress).toHaveBeenCalledWith("ws:ok", "0xmaker");
    expect(updateMakerAddress).toHaveBeenCalledTimes(1);
  });

  it("dryRun считает найденные строки, но не пишет maker_address", async () => {
    const rows = [
      {
        id: "ws:dry",
        market: "0xmarket",
        asset_id: "asset-1",
        side: "BUY",
        size: "2500",
        price: "0.5",
        match_time: new Date(1_700_000_000_000),
      },
    ];
    const findMakerAddress = vi.fn().mockResolvedValue("0xmaker");
    const updateMakerAddress = vi.fn().mockResolvedValue(undefined);

    const service = new UnknownTradeRepairService(
      { createQueryBuilder: vi.fn().mockReturnValue(createQueryBuilder(rows)) } as unknown as Repository<Trade>,
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      { updateMakerAddress } as unknown as TradesService,
    );

    await expect(service.repairBatch({ limit: 1, dryRun: true })).resolves.toEqual({
      scanned: 1,
      updated: 1,
      missed: 0,
      failed: 0,
    });
    expect(updateMakerAddress).not.toHaveBeenCalled();
  });

  it("при order='recent' сортирует по match_time DESC, а не по notional", async () => {
    const qb = createQueryBuilder([]);
    const service = new UnknownTradeRepairService(
      { createQueryBuilder: vi.fn().mockReturnValue(qb) } as unknown as Repository<Trade>,
      { findMakerAddress: vi.fn() } as unknown as LiveTradeEnricherService,
      {} as unknown as TradesService,
    );

    await service.repairBatch({ limit: 10, order: "recent" });

    expect(qb.orderBy).toHaveBeenCalledWith("t.match_time", "DESC");
    expect(qb.orderBy).not.toHaveBeenCalledWith(
      "(t.size::numeric * t.price::numeric)",
      "DESC",
    );
    expect(qb.addOrderBy).toHaveBeenCalledWith("t.id", "ASC");
  });

  it("выдерживает задержку между строками при delayMs > 0", async () => {
    const rows = [
      { id: "ws:a", market: "0xm", asset_id: "a1", side: "BUY", size: "100", price: "0.5", match_time: new Date(1_700_000_000_000) },
      { id: "ws:b", market: "0xm", asset_id: "a2", side: "BUY", size: "100", price: "0.5", match_time: new Date(1_700_000_001_000) },
      { id: "ws:c", market: "0xm", asset_id: "a3", side: "BUY", size: "100", price: "0.5", match_time: new Date(1_700_000_002_000) },
    ];
    const findMakerAddress = vi.fn().mockResolvedValue(null);
    const service = new UnknownTradeRepairService(
      { createQueryBuilder: vi.fn().mockReturnValue(createQueryBuilder(rows)) } as unknown as Repository<Trade>,
      { findMakerAddress } as unknown as LiveTradeEnricherService,
      {} as unknown as TradesService,
    );
    const delaySpy = vi
      .spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, "delay")
      .mockResolvedValue(undefined);

    await service.repairBatch({ limit: 3, delayMs: 200 });

    // Задержка между строками, но не после последней: N-1 раз.
    expect(delaySpy).toHaveBeenCalledTimes(2);
    expect(delaySpy).toHaveBeenCalledWith(200);
  });

  it("не сканирует БД при нулевом лимите", async () => {
    const createQueryBuilderMock = vi.fn();
    const service = new UnknownTradeRepairService(
      { createQueryBuilder: createQueryBuilderMock } as unknown as Repository<Trade>,
      {} as unknown as LiveTradeEnricherService,
      {} as unknown as TradesService,
    );

    await expect(service.repairBatch({ limit: 0 })).resolves.toEqual({
      scanned: 0,
      updated: 0,
      missed: 0,
      failed: 0,
    });
    expect(createQueryBuilderMock).not.toHaveBeenCalled();
  });
});
