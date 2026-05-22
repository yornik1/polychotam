import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import type { TradeEnrichmentJob } from "../types/contracts.js";
import { LiveTradeEnricherService } from "./live-trade-enricher.service.js";

describe("LiveTradeEnricherService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createService() {
    const config = {
      get: vi.fn((key: string) =>
        key === "POLYMARKET_DATA_API_URL"
          ? "https://data-api.polymarket.com"
          : undefined,
      ),
    } as Pick<ConfigService, "get"> as ConfigService;

    return new LiveTradeEnricherService(config);
  }

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

  it("находит makerAddress по совпавшей сигнатуре сделки", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          market: "0xmarket",
          asset_id: "asset-1",
          side: "BUY",
          size: "219.217767",
          price: "0.456",
          match_time: 1700000000,
          maker_address: "0xmaker",
        },
      ]),
    });
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    const result = await createService().findMakerAddress(createJob());

    expect(result).toBe("0xmaker");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://data-api.polymarket.com/trades?market=0xmarket&asset_id=asset-1&limit=200",
    );
  });

  it("возвращает null, если совпадение в data API не найдено", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            market: "0xother",
            asset_id: "asset-1",
            side: "BUY",
            size: "219.217767",
            price: "0.456",
            match_time: 1700000000,
            maker_address: "0xmaker",
          },
        ]),
      }),
    );

    const result = await createService().findMakerAddress(createJob());

    expect(result).toBeNull();
  });

  it("матчит сделку при различии форматирования price/size (trailing zeros)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            market: "0xmarket",
            asset_id: "asset-1",
            side: "BUY",
            size: "219.21776700",
            price: "0.4560",
            match_time: 1700000000,
            maker_address: "0xtrailing",
          },
        ]),
      }),
    );

    const result = await createService().findMakerAddress(createJob());

    expect(result).toBe("0xtrailing");
  });

  it("матчит сделку при расхождении timestamp в пределах 10 секунд", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            market: "0xmarket",
            asset_id: "asset-1",
            side: "BUY",
            size: "219.217767",
            price: "0.456",
            match_time: 1700000009,
            maker_address: "0xclose-ts",
          },
        ]),
      }),
    );

    const result = await createService().findMakerAddress(createJob());

    expect(result).toBe("0xclose-ts");
  });

  it("не матчит сделку при расхождении timestamp больше 10 секунд", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            market: "0xmarket",
            asset_id: "asset-1",
            side: "BUY",
            size: "219.217767",
            price: "0.456",
            match_time: 1700000011,
            maker_address: "0xfar-ts",
          },
        ]),
      }),
    );

    const result = await createService().findMakerAddress(createJob());

    expect(result).toBeNull();
  });

  it("матчит сделку при округлении price на стороне WS (0.933 vs 0.9329999...)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            market: "0xmarket",
            asset_id: "asset-1",
            side: "BUY",
            size: "219.217767",
            price: 0.4559999234939844,
            match_time: 1700000000,
            maker_address: "0xprice-approx",
          },
        ]),
      }),
    );

    const result = await createService().findMakerAddress(createJob());

    expect(result).toBe("0xprice-approx");
  });

  it("бросает ошибку при невалидном payload upstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ invalid: true }),
      }),
    );

    await expect(createService().findMakerAddress(createJob())).rejects.toThrow(
      /invalid/i,
    );
  });
});
