import { describe, it, expect } from "vitest";
import { computeWalletScore } from "./wallet-score.util.js";

describe("computeWalletScore", () => {
  it("возвращает null при sampleSize=29 (гейт)", () => {
    expect(
      computeWalletScore({ pnl90d: 5000, winRate: 0.7, profitFactor: 2, sampleSize: 29 }),
    ).toBeNull();
  });

  it("возвращает число при sampleSize=30 (граница гейта)", () => {
    const result = computeWalletScore({
      pnl90d: 5000,
      winRate: 0.7,
      profitFactor: 2,
      sampleSize: 30,
    });
    expect(result).not.toBeNull();
    expect(typeof result).toBe("number");
  });

  it("profit factor null даёт нейтральный вес 0.5 и score считается", () => {
    const withNull = computeWalletScore({
      pnl90d: 1000,
      winRate: 0.6,
      profitFactor: null,
      sampleSize: 30,
    });
    // profitFactor=1 → 1/(1+1)=0.5 — то же что null
    const withOne = computeWalletScore({
      pnl90d: 1000,
      winRate: 0.6,
      profitFactor: 1,
      sampleSize: 30,
    });
    expect(withNull).not.toBeNull();
    expect(withNull).toBeCloseTo(withOne as number, 6);
  });

  it("нулевые убытки (profitFactor=null) — score не null", () => {
    const result = computeWalletScore({
      pnl90d: 2000,
      winRate: 0.8,
      profitFactor: null,
      sampleSize: 50,
    });
    expect(result).not.toBeNull();
  });

  it("итоговый score в диапазоне 0..100", () => {
    const cases: Array<Parameters<typeof computeWalletScore>[0]> = [
      { pnl90d: 100_000, winRate: 1.0, profitFactor: 10, sampleSize: 100 },
      { pnl90d: -50_000, winRate: 0.0, profitFactor: 0, sampleSize: 50 },
      { pnl90d: 0, winRate: 0.5, profitFactor: null, sampleSize: 30 },
    ];
    for (const c of cases) {
      const s = computeWalletScore(c);
      expect(s).not.toBeNull();
      expect(s as number).toBeGreaterThanOrEqual(0);
      expect(s as number).toBeLessThanOrEqual(100);
    }
  });

  it("более высокий положительный pnl → более высокий score (при одинаковых остальных)", () => {
    const low = computeWalletScore({ pnl90d: 100, winRate: 0.6, profitFactor: 2, sampleSize: 30 });
    const high = computeWalletScore({ pnl90d: 10_000, winRate: 0.6, profitFactor: 2, sampleSize: 30 });
    expect(high as number).toBeGreaterThan(low as number);
  });

  it("отрицательный pnl даёт более низкий score, чем нулевой", () => {
    const neg = computeWalletScore({ pnl90d: -5000, winRate: 0.6, profitFactor: 2, sampleSize: 30 });
    const zero = computeWalletScore({ pnl90d: 0, winRate: 0.6, profitFactor: 2, sampleSize: 30 });
    expect(neg as number).toBeLessThan(zero as number);
  });

  // ─── edge / roi (Ф5), обратная совместимость ────────────────────────────────

  it("без edge/roi — поведение идентично прежней формуле", () => {
    // edge=0, roi=0 дают нейтраль 0.5, но путь с весами 0.7/0.2/0.1 ≠ базовому;
    // поэтому именно ОТСУТСТВИЕ полей должно давать ровно базовую формулу.
    const base = computeWalletScore({ pnl90d: 1000, winRate: 0.6, profitFactor: 2, sampleSize: 40 });
    const baseAgain = computeWalletScore({
      pnl90d: 1000,
      winRate: 0.6,
      profitFactor: 2,
      sampleSize: 40,
    });
    expect(base).toBeCloseTo(baseAgain as number, 9);
  });

  it("более высокий edge → более высокий score (монотонность)", () => {
    const lowEdge = computeWalletScore({
      pnl90d: 1000, winRate: 0.6, profitFactor: 2, sampleSize: 40, edge: 0.0,
    });
    const highEdge = computeWalletScore({
      pnl90d: 1000, winRate: 0.6, profitFactor: 2, sampleSize: 40, edge: 0.3,
    });
    expect(highEdge as number).toBeGreaterThan(lowEdge as number);
  });

  it("более высокий roi → более высокий score (монотонность)", () => {
    const lowRoi = computeWalletScore({
      pnl90d: 1000, winRate: 0.6, profitFactor: 2, sampleSize: 40, roi: 0.0,
    });
    const highRoi = computeWalletScore({
      pnl90d: 1000, winRate: 0.6, profitFactor: 2, sampleSize: 40, roi: 0.5,
    });
    expect(highRoi as number).toBeGreaterThan(lowRoi as number);
  });

  it("score с edge/roi остаётся в 0..100", () => {
    const s = computeWalletScore({
      pnl90d: 100_000, winRate: 1.0, profitFactor: 10, sampleSize: 100, edge: 0.6, roi: 2,
    });
    expect(s as number).toBeGreaterThanOrEqual(0);
    expect(s as number).toBeLessThanOrEqual(100);
  });
});
