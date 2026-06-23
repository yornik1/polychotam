import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import type { ClosedPositionRaw, MarketHoldersRaw } from "../types/contracts.js";
import { Market } from "../markets/market.entity.js";
import { SmartWallet } from "./smart-wallet.entity.js";
import { DataApiClient } from "../polymarket/data-api.client.js";
import { CandidateDiscoveryService, DISCOVERED_SOURCE } from "./candidate-discovery.service.js";

function makeConfig(values: Record<string, string> = {}): ConfigService {
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function holderGroup(holders: Array<{ proxyWallet: string; amount: number }>): MarketHoldersRaw {
  return {
    token: "tok",
    holders: holders.map((h) => ({
      proxyWallet: h.proxyWallet,
      asset: "tok",
      amount: h.amount,
      outcomeIndex: 0,
    })),
  };
}

describe("CandidateDiscoveryService.discoverFromTopMarkets", () => {
  let marketRepo: { find: ReturnType<typeof vi.fn> };
  let smartWalletRepo: {
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let dataApi: { fetchHolders: ReturnType<typeof vi.fn>; fetchClosedPositions: ReturnType<typeof vi.fn> };
  let service: CandidateDiscoveryService;

  beforeEach(() => {
    marketRepo = { find: vi.fn() };
    smartWalletRepo = {
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    dataApi = { fetchHolders: vi.fn(), fetchClosedPositions: vi.fn() };
    service = new CandidateDiscoveryService(
      marketRepo as unknown as Repository<Market>,
      smartWalletRepo as unknown as Repository<SmartWallet>,
      dataApi as unknown as DataApiClient,
      makeConfig(),
    );
  });

  it("дедупит адреса и фильтрует по minAmount, вставляет как discovered/active=false", async () => {
    marketRepo.find.mockResolvedValue([{ condition_id: "0xc1" }, { condition_id: "0xc2" }]);
    dataApi.fetchHolders.mockImplementation((cond: string) => {
      if (cond === "0xc1") {
        return Promise.resolve([
          holderGroup([
            { proxyWallet: "0xAAA", amount: 500 },
            { proxyWallet: "0xbbb", amount: 50 }, // ниже minAmount
          ]),
        ]);
      }
      return Promise.resolve([holderGroup([{ proxyWallet: "0xaaa", amount: 300 }])]); // дубль (другой кейс)
    });

    const result = await service.discoverFromTopMarkets({ minAmount: 100 });

    expect(result.marketsScanned).toBe(2);
    expect(result.addressesFound).toBe(1); // 0xaaa один раз, 0xbbb отфильтрован
    expect(result.inserted).toBe(1);
    expect(smartWalletRepo.insert).toHaveBeenCalledTimes(1);
    expect(smartWalletRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ address: "0xaaa", source: DISCOVERED_SOURCE, active: false }),
    );
  });

  it("не перезаписывает существующие адреса любого источника", async () => {
    marketRepo.find.mockResolvedValue([{ condition_id: "0xc1" }]);
    dataApi.fetchHolders.mockResolvedValue([
      holderGroup([
        { proxyWallet: "0xexisting", amount: 999 },
        { proxyWallet: "0xnew", amount: 999 },
      ]),
    ]);
    smartWalletRepo.find.mockResolvedValue([{ address: "0xexisting" }]);

    const result = await service.discoverFromTopMarkets({ minAmount: 100 });

    expect(result.addressesFound).toBe(2);
    expect(result.skippedExisting).toBe(1);
    expect(result.inserted).toBe(1);
    expect(smartWalletRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ address: "0xnew" }),
    );
  });

  it("ошибка Data API по одному рынку не рвёт проход", async () => {
    marketRepo.find.mockResolvedValue([{ condition_id: "0xc1" }, { condition_id: "0xc2" }]);
    dataApi.fetchHolders.mockImplementation((cond: string) => {
      if (cond === "0xc1") return Promise.reject(new Error("429"));
      return Promise.resolve([holderGroup([{ proxyWallet: "0xok", amount: 200 }])]);
    });

    const result = await service.discoverFromTopMarkets({ minAmount: 100 });

    expect(result.inserted).toBe(1);
  });

  it("пустой ответ holders → ничего не вставляет", async () => {
    marketRepo.find.mockResolvedValue([{ condition_id: "0xc1" }]);
    dataApi.fetchHolders.mockResolvedValue([]);

    const result = await service.discoverFromTopMarkets();

    expect(result.addressesFound).toBe(0);
    expect(result.inserted).toBe(0);
    expect(smartWalletRepo.insert).not.toHaveBeenCalled();
  });

  // ─── scoreAndPromoteDiscovered ──────────────────────────────────────────────

  function closedPos(overrides: Partial<ClosedPositionRaw> = {}): ClosedPositionRaw {
    return {
      proxyWallet: "0xw",
      asset: "a",
      conditionId: "c",
      avgPrice: 0.5,
      totalBought: 10,
      realizedPnl: 0,
      ...overrides,
    };
  }

  it("промоутит прошедшего гейты в active=true", async () => {
    smartWalletRepo.find.mockResolvedValue([{ address: "0xgood" }]);
    const positions = [
      ...Array.from({ length: 30 }, () => closedPos({ realizedPnl: 1, avgPrice: 0.5 })),
      ...Array.from({ length: 10 }, () => closedPos({ realizedPnl: -1, avgPrice: 0.5 })),
    ];
    dataApi.fetchClosedPositions.mockResolvedValue(positions);

    const result = await service.scoreAndPromoteDiscovered({ minSampleSize: 30, minWinRate: 0.55 });

    expect(result.evaluated).toBe(1);
    expect(result.promoted).toBe(1);
    expect(smartWalletRepo.update).toHaveBeenCalledWith(
      { address: "0xgood" },
      expect.objectContaining({ active: true }),
    );
  });

  it("отклоняет фермера (avgEntry>0.95)", async () => {
    smartWalletRepo.find.mockResolvedValue([{ address: "0xfarmer" }]);
    dataApi.fetchClosedPositions.mockResolvedValue(
      Array.from({ length: 40 }, () => closedPos({ realizedPnl: 0.1, avgPrice: 0.97 })),
    );

    const result = await service.scoreAndPromoteDiscovered({ minSampleSize: 30 });

    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(smartWalletRepo.update).not.toHaveBeenCalled();
  });

  it("отклоняет по малой выборке", async () => {
    smartWalletRepo.find.mockResolvedValue([{ address: "0xsmall" }]);
    dataApi.fetchClosedPositions.mockResolvedValue(
      Array.from({ length: 5 }, () => closedPos({ realizedPnl: 1, avgPrice: 0.4 })),
    );

    const result = await service.scoreAndPromoteDiscovered({ minSampleSize: 30 });

    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(1);
  });

  it("изолирует ошибку Data API на кошелёк", async () => {
    smartWalletRepo.find.mockResolvedValue([{ address: "0xa" }, { address: "0xb" }]);
    dataApi.fetchClosedPositions.mockImplementation((addr: string) => {
      if (addr === "0xa") return Promise.reject(new Error("timeout"));
      return Promise.resolve(Array.from({ length: 30 }, () => closedPos({ realizedPnl: 1, avgPrice: 0.4 })));
    });

    const result = await service.scoreAndPromoteDiscovered({ minSampleSize: 30 });

    expect(result.failed).toBe(1);
    expect(result.promoted).toBe(1);
  });
});
