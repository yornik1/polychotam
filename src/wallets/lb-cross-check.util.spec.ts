import { describe, it, expect } from "vitest";
import { classifyDivergence } from "./lb-cross-check.util.js";
import type { DivergenceThresholds } from "./lb-cross-check.util.js";

/** Стандартные пороги из плана (калибровочные 2026-06-10). */
const thresholds: DivergenceThresholds = {
  epsAbs: 1,
  epsRel: 0.01,
  investigateAbs: 50,
  investigateRel: 0.02,
};

describe("classifyDivergence", () => {
  // --- pass ---

  it("точное совпадение → pass", () => {
    expect(classifyDivergence(0, 0, thresholds)).toBe("pass");
  });

  it("diff в пределах epsAbs → pass", () => {
    // |diff| = 0.5 ≤ max(1, 0.01·100) = max(1, 1) = 1
    expect(classifyDivergence(100.5, 100, thresholds)).toBe("pass");
  });

  it("diff ровно на границе epsAbs (lb=0) → pass", () => {
    // lb=0: порог = max(1, 0) = 1; diff = 1 → pass
    expect(classifyDivergence(1, 0, thresholds)).toBe("pass");
  });

  it("lb=0, diff чуть меньше epsAbs → pass", () => {
    expect(classifyDivergence(0.99, 0, thresholds)).toBe("pass");
  });

  it("эмпирическая фикстура: pnl_v2=−8.34 lb=−7.66 → pass", () => {
    // diff = |−8.34 − (−7.66)| = |−0.68| = 0.68 ≤ max(1, 0.01·7.66=0.0766) = 1
    expect(classifyDivergence(-8.34, -7.66, thresholds)).toBe("pass");
  });

  it("эмпирическая фикстура: diff −0.10 → pass", () => {
    // pnlV2 = lb + 0.10; diff = 0.10 ≤ 1
    expect(classifyDivergence(-7.56, -7.66, thresholds)).toBe("pass");
  });

  it("отрицательный lb, небольшой diff → pass", () => {
    // lb = −500, epsRel·|lb| = 5, diff = 3 ≤ max(1, 5) = 5
    expect(classifyDivergence(-503, -500, thresholds)).toBe("pass");
  });

  // --- fail ---

  it("diff чуть больше epsAbs но меньше investigateAbs → fail", () => {
    // diff = 2 > max(1, 0.01·0) = 1 и 2 ≤ max(50, 0) = 50
    expect(classifyDivergence(2, 0, thresholds)).toBe("fail");
  });

  it("эмпирическая фикстура: pnl_v2=+3.02 lb=+31.68 → fail", () => {
    // diff = |3.02 − 31.68| = 28.66 > max(1, 0.01·31.68=0.3168) = 1 и ≤ max(50, 0.02·31.68=0.6336) = 50
    expect(classifyDivergence(3.02, 31.68, thresholds)).toBe("fail");
  });

  it("diff 3–37 (необъяснённые расхождения из плана) → fail, а не pass", () => {
    expect(classifyDivergence(-3.16 + 100, 100, thresholds)).toBe("fail");
    expect(classifyDivergence(-28.67 + 100, 100, thresholds)).toBe("fail");
    expect(classifyDivergence(-37.57 + 100, 100, thresholds)).toBe("fail");
  });

  it("diff ровно на границе investigateAbs → fail (не investigate)", () => {
    // diff = 50 = investigateAbs, но условие: diff > investigateThreshold → investigate
    // diff == investigateThreshold → НЕ > → fail
    expect(classifyDivergence(50, 0, thresholds)).toBe("fail");
  });

  // --- investigate ---

  it("diff > investigateAbs → investigate", () => {
    // diff = 51 > max(50, 0.02·0) = 50
    expect(classifyDivergence(51, 0, thresholds)).toBe("investigate");
  });

  it("эмпирическая фикстура: diff 60 → investigate", () => {
    expect(classifyDivergence(160, 100, thresholds)).toBe("investigate");
  });

  it("большой lb, diff превышает investigateRel·|lb| → investigate", () => {
    // lb = 10_000, investigateRel·|lb| = 200 > investigateAbs=50 → порог = 200
    // diff = 250 > 200 → investigate
    expect(classifyDivergence(10250, 10000, thresholds)).toBe("investigate");
  });

  it("lb отрицательный, diff > investigateAbs → investigate", () => {
    expect(classifyDivergence(-60, 0, thresholds)).toBe("investigate");
  });

  // --- граничный случай: lb строго отрицательный ---

  it("lb=−7.66: порог pass = max(1, 0.0766) = 1, diff=0.68 → pass", () => {
    expect(classifyDivergence(-7.66 + 0.68, -7.66, thresholds)).toBe("pass");
  });

  it("lb=−7.66: diff=2 → fail", () => {
    expect(classifyDivergence(-7.66 + 2, -7.66, thresholds)).toBe("fail");
  });
});
