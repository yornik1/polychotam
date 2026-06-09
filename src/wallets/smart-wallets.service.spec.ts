import { describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import { Market } from "../markets/market.entity.js";
import { Trade } from "../trades/trade.entity.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import {
  SmartWalletsService,
  type SmartWalletRefreshOptions,
  type SmartWalletRefreshResult,
} from "./smart-wallets.service.js";

function trade(input: {
  address: string;
  assetId: string;
  side: "BUY" | "SELL";
  size: string;
  price: string;
  matchTime: Date;
  market: Pick<Market, "closed" | "winning_token_id">;
}): Trade {
  return {
    maker_address: input.address,
    asset_id: input.assetId,
    side: input.side,
    size: input.size,
    price: input.price,
    match_time: input.matchTime,
    market: input.market as Market,
  } as Trade;
}

function smartWallet(input: {
  address: string;
  source: string;
  active?: boolean;
}): SmartWallet {
  return {
    address: input.address,
    active: input.active ?? true,
    source: input.source,
    notes: "",
    hit_rate: null,
    sum_pnl: null,
    roi_pct: null,
    whale_trade_count: 0,
    internal_created_at: new Date("2026-01-01T00:00:00.000Z"),
    internal_updated_at: new Date("2026-01-01T00:00:00.000Z"),
  } as SmartWallet;
}

function createService() {
  const smartWalletFind = vi.fn<() => Promise<SmartWallet[]>>().mockResolvedValue([]);
  const smartWalletUpsert = vi.fn().mockResolvedValue(undefined);
  const smartWalletUpdate = vi.fn().mockResolvedValue(undefined);
  const smartWalletTransaction = vi.fn(
    async (
      callback: (manager: { getRepository: (entity: typeof SmartWallet) => Repository<SmartWallet> }) => Promise<void>,
    ) => callback({
      getRepository: () => smartWalletRepository,
    }),
  );
  const tradeFind = vi.fn<() => Promise<Trade[]>>().mockResolvedValue([]);

  const smartWalletRepositoryBase = {
    find: smartWalletFind,
    upsert: smartWalletUpsert,
    update: smartWalletUpdate,
  } as Pick<Repository<SmartWallet>, "find" | "upsert" | "update">;

  const smartWalletRepository = {
    ...smartWalletRepositoryBase,
    manager: {
      transaction: smartWalletTransaction,
    },
  } as unknown as Repository<SmartWallet>;

  const tradeRepository = {
    find: tradeFind,
  } as Pick<Repository<Trade>, "find"> as Repository<Trade>;

  const service = new SmartWalletsService(smartWalletRepository, tradeRepository);
  const refreshService = service as unknown as {
    refreshSmartWallets(options: SmartWalletRefreshOptions): Promise<SmartWalletRefreshResult>;
  };

  return {
    service,
    refreshService,
    smartWalletFind,
    smartWalletUpsert,
    smartWalletUpdate,
    smartWalletTransaction,
    tradeFind,
  };
}

describe("SmartWalletsService refreshSmartWallets", () => {
  it("dryRun возвращает audit без мутаций и сохраняет same-shape результат", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-06-09T00:00:00.000Z").getTime(),
    );
    const {
      service,
      refreshService,
      smartWalletFind,
      smartWalletUpsert,
      smartWalletUpdate,
      smartWalletTransaction,
      tradeFind,
    } =
      createService();
    const invalidateCache = vi.spyOn(service, "invalidateCache");

    smartWalletFind.mockResolvedValue([
      smartWallet({ address: "0xmanual", source: "manual" }),
      smartWallet({ address: "0xstale", source: "research" }),
    ]);
    tradeFind.mockResolvedValue([
      trade({
        address: "0xGOOD",
        assetId: "yes",
        side: "BUY",
        size: "10",
        price: "0.4",
        matchTime: new Date("2026-06-01T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xgood",
        assetId: "no",
        side: "BUY",
        size: "5",
        price: "0.25",
        matchTime: new Date("2026-06-02T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xgood",
        assetId: "no",
        side: "SELL",
        size: "2",
        price: "0.7",
        matchTime: new Date("2026-06-03T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xstale",
        assetId: "no",
        side: "BUY",
        size: "8",
        price: "0.3",
        matchTime: new Date("2026-06-01T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xstale",
        assetId: "yes",
        side: "SELL",
        size: "4",
        price: "0.6",
        matchTime: new Date("2026-06-02T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
    ]);

    const result = await refreshService.refreshSmartWallets({
      dryRun: true,
      freshnessDays: 90,
      minResolvedTrades: 3,
      minWinRate: 0.6,
      minTotalRisk: 5,
      minSelectedForDeactivation: 1,
      limit: 10,
    });

    expect(tradeFind).toHaveBeenCalledWith({
      relations: { market: true },
      order: { match_time: "ASC" },
    });
    expect(smartWalletFind).toHaveBeenCalledWith({ where: { active: true } });
    expect(result.dryRun).toBe(true);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]).toMatchObject({
      address: "0xgood",
      active: true,
      source: "auto_scoring",
      hit_rate: "0.666667",
      sum_pnl: "6.15",
      roi_pct: "105.1282",
      whale_trade_count: 3,
    });
    expect(result.deactivated).toEqual(["0xstale"]);
    expect(result.skipped).toEqual([expect.objectContaining({ address: "0xstale" })]);
    expect(result.dataGaps).toEqual([]);
    expect(result.thresholds).toEqual({
      freshnessDays: 90,
      minResolvedTrades: 3,
      minWinRate: 0.6,
      minTotalRisk: 5,
      minSelectedForDeactivation: 1,
      limit: 10,
    });
    expect(result.selected[0]?.notes).toContain("auto:");
    expect(result.selected[0]?.notes).toContain("pnl=6.15");
    expect(result.selected[0]?.notes).toContain("hr=66.6667%");
    expect(result.selected[0]?.notes).toContain("resolved=3");
    expect(result.selected[0]?.notes).toContain("risk=5.85");
    expect(result.selected[0]?.notes).toContain("last=2026-06-03");
    expect(smartWalletUpsert).not.toHaveBeenCalled();
    expect(smartWalletUpdate).not.toHaveBeenCalled();
    expect(smartWalletTransaction).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("write-mode upserts selected wallets, deactivates stale auto/research rows и invalidates cache", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-06-09T00:00:00.000Z").getTime(),
    );
    const {
      service,
      refreshService,
      smartWalletFind,
      smartWalletUpsert,
      smartWalletUpdate,
      smartWalletTransaction,
      tradeFind,
    } =
      createService();
    const invalidateCache = vi.spyOn(service, "invalidateCache");

    smartWalletFind.mockResolvedValue([
      smartWallet({ address: "0xmanual", source: "manual" }),
      smartWallet({ address: "0xstale", source: "research" }),
      smartWallet({ address: "0xlegacy", source: "auto_scoring" }),
    ]);
    tradeFind.mockResolvedValue([
      trade({
        address: "0xGOOD",
        assetId: "yes",
        side: "BUY",
        size: "10",
        price: "0.4",
        matchTime: new Date("2026-06-01T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xgood",
        assetId: "no",
        side: "BUY",
        size: "5",
        price: "0.25",
        matchTime: new Date("2026-06-02T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xgood",
        assetId: "no",
        side: "SELL",
        size: "2",
        price: "0.7",
        matchTime: new Date("2026-06-03T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xstale",
        assetId: "no",
        side: "BUY",
        size: "8",
        price: "0.3",
        matchTime: new Date("2026-06-01T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
      trade({
        address: "0xstale",
        assetId: "yes",
        side: "SELL",
        size: "4",
        price: "0.6",
        matchTime: new Date("2026-06-02T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
    ]);

    const result = await refreshService.refreshSmartWallets({
      freshnessDays: 90,
      minResolvedTrades: 3,
      minWinRate: 0.6,
      minTotalRisk: 5,
      minSelectedForDeactivation: 1,
      limit: 10,
    });

    expect(result.dryRun).toBe(false);
    expect(result.selected).toHaveLength(1);
    expect(result.deactivated).toEqual(["0xstale", "0xlegacy"]);
    expect(result.skipped).toEqual([expect.objectContaining({ address: "0xstale" })]);
    expect(smartWalletUpsert).toHaveBeenCalledTimes(1);
    expect(smartWalletUpdate).toHaveBeenCalledTimes(1);
    expect(smartWalletTransaction).toHaveBeenCalledTimes(1);
    expect(invalidateCache).toHaveBeenCalledTimes(1);
    expect(smartWalletUpdate.mock.calls[0]?.[1]).toEqual({ active: false });
    expect(smartWalletUpsert.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: "0xgood",
          active: true,
          source: "auto_scoring",
        }),
      ]),
    );
    nowSpy.mockRestore();
  });

  it("не деактивирует existing active wallets, если selected count ниже guard", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-06-09T00:00:00.000Z").getTime(),
    );
    const {
      service,
      refreshService,
      smartWalletFind,
      smartWalletUpsert,
      smartWalletUpdate,
      smartWalletTransaction,
      tradeFind,
    } =
      createService();
    const invalidateCache = vi.spyOn(service, "invalidateCache");

    smartWalletFind.mockResolvedValue([
      smartWallet({ address: "0xmanual", source: "manual" }),
      smartWallet({ address: "0xstale", source: "research" }),
    ]);
    tradeFind.mockResolvedValue([
      trade({
        address: "0xgood",
        assetId: "yes",
        side: "BUY",
        size: "10",
        price: "0.4",
        matchTime: new Date("2026-06-01T00:00:00.000Z"),
        market: { closed: true, winning_token_id: "yes" },
      }),
    ]);

    const result = await refreshService.refreshSmartWallets({
      freshnessDays: 90,
      minResolvedTrades: 1,
      minWinRate: 0.5,
      minTotalRisk: 1,
      minSelectedForDeactivation: 2,
      limit: 10,
    });

    expect(result.selected).toHaveLength(1);
    expect(result.deactivated).toEqual([]);
    expect(smartWalletUpsert).toHaveBeenCalledTimes(1);
    expect(smartWalletUpdate).not.toHaveBeenCalled();
    expect(smartWalletTransaction).toHaveBeenCalledTimes(1);
    expect(invalidateCache).toHaveBeenCalledTimes(1);
    expect(result.selected[0]?.address).toBe("0xgood");
    nowSpy.mockRestore();
  });
});
