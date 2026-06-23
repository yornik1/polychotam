import { describe, expect, it } from "vitest";
import type { ClosedPositionRaw } from "../types/contracts.js";
import {
  computeDiscoveredStats,
  isOutlierDriven,
  medianAbsoluteDeviation,
  shrinkWinRate,
  FARMER_AVG_ENTRY_THRESHOLD,
  INSIDER_ENTRY_THRESHOLD,
} from "./discovered-stats.util.js";

function pos(overrides: Partial<ClosedPositionRaw> = {}): ClosedPositionRaw {
  return {
    proxyWallet: "0xabc",
    asset: "a",
    conditionId: "c",
    avgPrice: 0.5,
    totalBought: 10,
    realizedPnl: 0,
    ...overrides,
  };
}

describe("computeDiscoveredStats", () => {
  it("пустой вход → нули и флаги false", () => {
    const s = computeDiscoveredStats([]);
    expect(s.sampleSize).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.isFarmer).toBe(false);
    expect(s.isOutlierDriven).toBe(false);
  });

  it("winRate, realizedPnl, avgEntry, roi считаются корректно", () => {
    const s = computeDiscoveredStats([
      pos({ realizedPnl: 5, avgPrice: 0.4, totalBought: 10 }),
      pos({ realizedPnl: -3, avgPrice: 0.6, totalBought: 10 }),
    ]);
    expect(s.sampleSize).toBe(2);
    expect(s.winRate).toBe(0.5);
    expect(s.realizedPnl).toBe(2);
    expect(s.avgEntryPrice).toBeCloseTo(0.5, 6);
    expect(s.roi).toBeCloseTo(2 / 20, 6);
  });

  it("edgeVsImplied = winRate − avgEntryPrice", () => {
    // 2 из 2 выигрыша, средний вход 0.4 → edge = 1.0 − 0.4 = 0.6
    const s = computeDiscoveredStats([
      pos({ realizedPnl: 1, avgPrice: 0.4 }),
      pos({ realizedPnl: 1, avgPrice: 0.4 }),
    ]);
    expect(s.edgeVsImplied).toBeCloseTo(0.6, 6);
  });

  it("insiderScore = доля выигрышных входов ниже порога", () => {
    const s = computeDiscoveredStats([
      pos({ realizedPnl: 1, avgPrice: INSIDER_ENTRY_THRESHOLD - 0.05 }), // insider-win
      pos({ realizedPnl: 1, avgPrice: 0.7 }), // win, не insider
      pos({ realizedPnl: -1, avgPrice: 0.2 }), // loss, не учитывается
    ]);
    expect(s.insiderScore).toBeCloseTo(0.5, 6);
  });

  it("isFarmer=true при среднем входе выше порога", () => {
    const s = computeDiscoveredStats([
      pos({ avgPrice: FARMER_AVG_ENTRY_THRESHOLD + 0.02, realizedPnl: 0.1 }),
      pos({ avgPrice: FARMER_AVG_ENTRY_THRESHOLD + 0.03, realizedPnl: 0.1 }),
    ]);
    expect(s.isFarmer).toBe(true);
  });
});

describe("shrinkWinRate", () => {
  it("малая выборка тянется к приору", () => {
    const shrunk = shrinkWinRate(1.0, 3, 0.5, 30);
    // (1*3 + 0.5*30)/33 = 18/33 ≈ 0.545
    expect(shrunk).toBeCloseTo(18 / 33, 6);
    expect(shrunk).toBeLessThan(0.6);
  });

  it("большая выборка тянется к raw", () => {
    const shrunk = shrinkWinRate(0.7, 300, 0.5, 30);
    expect(shrunk).toBeGreaterThan(0.68);
  });

  it("denom<=0 → приор", () => {
    expect(shrinkWinRate(0.9, 0, 0.4, 0)).toBe(0.4);
  });
});

describe("isOutlierDriven / MAD", () => {
  it("одно доминирующее значение → true", () => {
    expect(isOutlierDriven([1, 1, 1, 1, 1000])).toBe(true);
  });

  it("ровная серия → false", () => {
    expect(isOutlierDriven([10, 11, 9, 10, 12])).toBe(false);
  });

  it("меньше 3 значений → false", () => {
    expect(isOutlierDriven([1, 1000])).toBe(false);
  });

  it("MAD ровной серии из одинаковых = 0", () => {
    expect(medianAbsoluteDeviation([5, 5, 5])).toBe(0);
  });
});
