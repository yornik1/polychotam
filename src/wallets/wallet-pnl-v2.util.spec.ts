import { describe, expect, it } from "vitest";
import type { WalletActivityRaw, WalletPositionRaw } from "../types/contracts.js";
import { computeCashFlowPnl } from "./wallet-pnl-v2.util.js";

// Вспомогательные фабрики
function activity(overrides: Partial<WalletActivityRaw>): WalletActivityRaw {
  return {
    proxyWallet: "0xabc",
    timestamp: 1000,
    conditionId: "cond1",
    type: "TRADE",
    size: 100,
    usdcSize: 50,
    transactionHash: "0xtx1",
    ...overrides,
  };
}

function position(overrides: Partial<WalletPositionRaw>): WalletPositionRaw {
  return {
    proxyWallet: "0xabc",
    asset: "asset1",
    conditionId: "cond1",
    size: 100,
    avgPrice: 0.5,
    curPrice: 0.6,
    currentValue: 60,
    ...overrides,
  };
}

describe("computeCashFlowPnl", () => {
  describe("пустые входы", () => {
    it("пустые activities и positions → всё нули", () => {
      const result = computeCashFlowPnl([], []);
      expect(result.realizedPnl).toBe(0);
      expect(result.openPositionsValue).toBe(0);
      expect(result.totalPnl).toBe(0);
      expect(result.byOperation).toEqual({});
      expect(result.hypothesisTypes).toEqual([]);
      expect(result.dataGaps).toEqual([]);
    });

    it("только positions (MTM-only) — нет activities", () => {
      const result = computeCashFlowPnl([], [position({ currentValue: 100 }), position({ currentValue: 50 })]);
      expect(result.realizedPnl).toBe(0);
      expect(result.openPositionsValue).toBe(150);
      expect(result.totalPnl).toBe(150);
    });

    it("только activities, нет positions — openPositionsValue=0", () => {
      const result = computeCashFlowPnl([activity({ type: "TRADE", side: "SELL", usdcSize: 40 })], []);
      expect(result.openPositionsValue).toBe(0);
      expect(result.realizedPnl).toBe(40);
    });
  });

  describe("TRADE:BUY — отток", () => {
    it("уменьшает realizedPnl", () => {
      const result = computeCashFlowPnl([activity({ type: "TRADE", side: "BUY", usdcSize: 100 })], []);
      expect(result.realizedPnl).toBe(-100);
      expect(result.byOperation["TRADE:BUY"]).toBe(100);
    });
  });

  describe("TRADE:SELL — приток", () => {
    it("увеличивает realizedPnl", () => {
      const result = computeCashFlowPnl([activity({ type: "TRADE", side: "SELL", usdcSize: 120 })], []);
      expect(result.realizedPnl).toBe(120);
      expect(result.byOperation["TRADE:SELL"]).toBe(120);
    });
  });

  describe("REDEEM — приток", () => {
    it("usdcSize > 0", () => {
      const result = computeCashFlowPnl([activity({ type: "REDEEM", side: undefined, usdcSize: 80 })], []);
      expect(result.realizedPnl).toBe(80);
      expect(result.byOperation["REDEEM"]).toBe(80);
    });

    it("usdcSize=0 — валидная запись, учитывается в byOperation", () => {
      const result = computeCashFlowPnl([activity({ type: "REDEEM", side: undefined, usdcSize: 0 })], []);
      expect(result.realizedPnl).toBe(0);
      expect(result.byOperation["REDEEM"]).toBe(0);
      expect(result.dataGaps).toEqual([]);
    });
  });

  describe("REWARD — приток", () => {
    it("увеличивает realizedPnl", () => {
      const result = computeCashFlowPnl([activity({ type: "REWARD", side: undefined, usdcSize: 5 })], []);
      expect(result.realizedPnl).toBe(5);
      expect(result.byOperation["REWARD"]).toBe(5);
    });
  });

  describe("MAKER_REBATE — приток", () => {
    it("увеличивает realizedPnl", () => {
      const result = computeCashFlowPnl([activity({ type: "MAKER_REBATE", side: undefined, usdcSize: 2 })], []);
      expect(result.realizedPnl).toBe(2);
      expect(result.byOperation["MAKER_REBATE"]).toBe(2);
    });
  });

  describe("гипотетические типы", () => {
    it("SPLIT — отток, добавляет SPLIT в hypothesisTypes", () => {
      const result = computeCashFlowPnl([activity({ type: "SPLIT", side: undefined, usdcSize: 10 })], []);
      expect(result.realizedPnl).toBe(-10);
      expect(result.byOperation["SPLIT"]).toBe(10);
      expect(result.hypothesisTypes).toContain("SPLIT");
    });

    it("MERGE — приток, добавляет MERGE в hypothesisTypes", () => {
      const result = computeCashFlowPnl([activity({ type: "MERGE", side: undefined, usdcSize: 15 })], []);
      expect(result.realizedPnl).toBe(15);
      expect(result.byOperation["MERGE"]).toBe(15);
      expect(result.hypothesisTypes).toContain("MERGE");
    });

    it("CONVERSION — не суммируется, добавляет CONVERSION в hypothesisTypes и dataGaps", () => {
      const result = computeCashFlowPnl([activity({ type: "CONVERSION", side: undefined, usdcSize: 20 })], []);
      expect(result.realizedPnl).toBe(0);
      expect(result.byOperation["CONVERSION"]).toBe(20);
      expect(result.hypothesisTypes).toContain("CONVERSION");
      expect(result.dataGaps.some((g) => g.includes("CONVERSION"))).toBe(true);
    });

    it("дубликаты гипотетических типов не дублируются в hypothesisTypes", () => {
      const result = computeCashFlowPnl(
        [
          activity({ type: "SPLIT", usdcSize: 5 }),
          activity({ type: "SPLIT", usdcSize: 3 }),
        ],
        [],
      );
      expect(result.hypothesisTypes.filter((t) => t === "SPLIT")).toHaveLength(1);
    });
  });

  describe("неизвестный тип", () => {
    it("не падает, пишет в dataGaps, не суммирует", () => {
      const result = computeCashFlowPnl(
        [activity({ type: "UNKNOWN_FUTURE_TYPE" as any, side: undefined, usdcSize: 50 })],
        [],
      );
      expect(result.realizedPnl).toBe(0);
      expect(result.dataGaps.some((g) => g.includes("UNKNOWN_FUTURE_TYPE") && g.includes("1 records"))).toBe(true);
    });

    it("несколько записей одного неизвестного типа — одна строка с количеством", () => {
      const result = computeCashFlowPnl(
        [
          activity({ type: "MYSTERY" as any, usdcSize: 10 }),
          activity({ type: "MYSTERY" as any, usdcSize: 20 }),
          activity({ type: "MYSTERY" as any, usdcSize: 30 }),
        ],
        [],
      );
      expect(result.dataGaps.some((g) => g.includes("MYSTERY") && g.includes("3 records"))).toBe(true);
      expect(result.realizedPnl).toBe(0);
    });
  });

  describe("TRADE без side или с неожиданным side", () => {
    it("TRADE без side → dataGaps, не падает", () => {
      const result = computeCashFlowPnl([activity({ type: "TRADE", side: undefined, usdcSize: 50 })], []);
      expect(result.realizedPnl).toBe(0);
      expect(result.dataGaps.some((g) => g.includes("TRADE") && g.includes("side"))).toBe(true);
    });

    it("TRADE с неожиданным side → dataGaps, не падает", () => {
      const result = computeCashFlowPnl(
        [activity({ type: "TRADE", side: "UNKNOWN_SIDE" as any, usdcSize: 50 })],
        [],
      );
      expect(result.realizedPnl).toBe(0);
      expect(result.dataGaps.some((g) => g.includes("TRADE") && g.includes("side"))).toBe(true);
    });
  });

  describe("NaN/невалидный usdcSize", () => {
    it("NaN usdcSize → dataGaps, запись пропускается", () => {
      const result = computeCashFlowPnl(
        [activity({ type: "TRADE", side: "SELL", usdcSize: NaN })],
        [],
      );
      expect(result.realizedPnl).toBe(0);
      expect(result.dataGaps.some((g) => g.includes("invalid usdcSize"))).toBe(true);
    });

    it("Infinity usdcSize → dataGaps, запись пропускается", () => {
      const result = computeCashFlowPnl(
        [activity({ type: "REDEEM", usdcSize: Infinity })],
        [],
      );
      expect(result.realizedPnl).toBe(0);
      expect(result.dataGaps.some((g) => g.includes("invalid usdcSize"))).toBe(true);
    });
  });

  describe("смешанный поток", () => {
    it("эмпирический пример: realized-only −199.40 + MTM 191.06 = −8.34", () => {
      // Кошелёк 0x2fb9a206, 299 операций — упрощённая модель
      const activities: WalletActivityRaw[] = [
        activity({ type: "TRADE", side: "BUY", usdcSize: 299.40 }),
        activity({ type: "TRADE", side: "SELL", usdcSize: 100 }),
      ];
      const pos: WalletPositionRaw[] = [position({ currentValue: 191.06 })];
      const result = computeCashFlowPnl(activities, pos);
      // realizedCashFlow = 100 - 299.40 = -199.40
      expect(result.realizedPnl).toBeCloseTo(-199.40, 5);
      expect(result.openPositionsValue).toBeCloseTo(191.06, 5);
      expect(result.totalPnl).toBeCloseTo(-8.34, 5);
    });

    it("несколько операций разных типов суммируются правильно", () => {
      const acts: WalletActivityRaw[] = [
        activity({ type: "TRADE", side: "BUY", usdcSize: 100 }),
        activity({ type: "TRADE", side: "SELL", usdcSize: 80 }),
        activity({ type: "REDEEM", side: undefined, usdcSize: 30 }),
        activity({ type: "REWARD", side: undefined, usdcSize: 5 }),
        activity({ type: "MAKER_REBATE", side: undefined, usdcSize: 2 }),
      ];
      const result = computeCashFlowPnl(acts, [position({ currentValue: 10 })]);
      // realized = 80 + 30 + 5 + 2 - 100 = 17
      expect(result.realizedPnl).toBeCloseTo(17, 10);
      expect(result.openPositionsValue).toBe(10);
      expect(result.totalPnl).toBeCloseTo(27, 10);
    });

    it("byOperation суммирует несколько записей одного типа", () => {
      const acts: WalletActivityRaw[] = [
        activity({ type: "TRADE", side: "BUY", usdcSize: 40 }),
        activity({ type: "TRADE", side: "BUY", usdcSize: 60 }),
        activity({ type: "TRADE", side: "SELL", usdcSize: 70 }),
      ];
      const result = computeCashFlowPnl(acts, []);
      expect(result.byOperation["TRADE:BUY"]).toBeCloseTo(100, 10);
      expect(result.byOperation["TRADE:SELL"]).toBeCloseTo(70, 10);
      expect(result.realizedPnl).toBeCloseTo(-30, 10);
    });
  });

  describe("MTM позиций", () => {
    it("суммирует currentValue всех позиций", () => {
      const pos: WalletPositionRaw[] = [
        position({ currentValue: 100 }),
        position({ currentValue: 50 }),
        position({ currentValue: 25 }),
      ];
      const result = computeCashFlowPnl([], pos);
      expect(result.openPositionsValue).toBe(175);
      expect(result.totalPnl).toBe(175);
    });

    it("NOT использует cashPnl/realizedPnl из positions — только currentValue", () => {
      // Убеждаемся что cashPnl/realizedPnl позиций не влияют на результат
      const pos: WalletPositionRaw[] = [
        position({ currentValue: 50, cashPnl: 9999, realizedPnl: 9999 }),
      ];
      const result = computeCashFlowPnl([], pos);
      expect(result.openPositionsValue).toBe(50);
      expect(result.totalPnl).toBe(50);
    });
  });
});
