import { describe, it, expect } from "vitest";
import {
  computeRollingCheck,
  ROLLING_DEACTIVATION_THRESHOLD,
} from "./smart-score-rolling.util.js";

const MIN_WIN_RATE = 0.55;

describe("computeRollingCheck", () => {
  it("14 дней подряд с низким винрейтом — деактивация", () => {
    // Накапливаем 13 дней, затем 14-й
    const result = computeRollingCheck({
      winRate: 0.4,
      consecutiveLowWinrateDays: ROLLING_DEACTIVATION_THRESHOLD - 1,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(ROLLING_DEACTIVATION_THRESHOLD);
    expect(result.shouldDeactivate).toBe(true);
  });

  it("13 дней подряд — ещё не деактивация", () => {
    const result = computeRollingCheck({
      winRate: 0.4,
      consecutiveLowWinrateDays: ROLLING_DEACTIVATION_THRESHOLD - 2,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(ROLLING_DEACTIVATION_THRESHOLD - 1);
    expect(result.shouldDeactivate).toBe(false);
  });

  it("прерывание серии сбрасывает счётчик в 0", () => {
    // Было 13 дней подряд, затем хороший день
    const result = computeRollingCheck({
      winRate: 0.7,
      consecutiveLowWinrateDays: ROLLING_DEACTIVATION_THRESHOLD - 1,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(0);
    expect(result.shouldDeactivate).toBe(false);
  });

  it("ровно на пороге 0.55 — НЕ триггерит (строгое <)", () => {
    // winRate = minWinRate — это НЕ «ниже порога»
    const result = computeRollingCheck({
      winRate: 0.55,
      consecutiveLowWinrateDays: ROLLING_DEACTIVATION_THRESHOLD - 1,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(0);
    expect(result.shouldDeactivate).toBe(false);
  });

  it("winRate = null трактуется как ниже порога — счётчик растёт", () => {
    const result = computeRollingCheck({
      winRate: null,
      consecutiveLowWinrateDays: 5,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(6);
    expect(result.shouldDeactivate).toBe(false);
  });

  it("счётчик = 0, хороший день — остаётся 0", () => {
    const result = computeRollingCheck({
      winRate: 0.8,
      consecutiveLowWinrateDays: 0,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(0);
    expect(result.shouldDeactivate).toBe(false);
  });

  it("ровно 14 уже в БД + ещё один плохой день — shouldDeactivate = true", () => {
    const result = computeRollingCheck({
      winRate: 0.3,
      consecutiveLowWinrateDays: ROLLING_DEACTIVATION_THRESHOLD,
      minWinRate: MIN_WIN_RATE,
    });

    expect(result.newConsecutiveDays).toBe(ROLLING_DEACTIVATION_THRESHOLD + 1);
    expect(result.shouldDeactivate).toBe(true);
  });
});
