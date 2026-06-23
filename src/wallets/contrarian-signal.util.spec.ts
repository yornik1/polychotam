import { describe, expect, it } from "vitest";
import {
  CONTRARIAN_YES_THRESHOLD,
  deriveYesPrice,
  isContrarianNoSignal,
  OUTCOME_INDEX_NO,
} from "./contrarian-signal.util.js";

describe("isContrarianNoSignal", () => {
  const base = { isTopWallet: true, side: "BUY" as const, outcomeIndex: OUTCOME_INDEX_NO, yesPrice: 0.85 };

  it("топ-кошелёк покупает No при Yes>порога → true", () => {
    expect(isContrarianNoSignal(base)).toBe(true);
  });

  it("не топ-кошелёк → false", () => {
    expect(isContrarianNoSignal({ ...base, isTopWallet: false })).toBe(false);
  });

  it("SELL → false", () => {
    expect(isContrarianNoSignal({ ...base, side: "SELL" })).toBe(false);
  });

  it("покупка Yes (index 0) → false", () => {
    expect(isContrarianNoSignal({ ...base, outcomeIndex: 0 })).toBe(false);
  });

  it("Yes ниже порога → false", () => {
    expect(isContrarianNoSignal({ ...base, yesPrice: CONTRARIAN_YES_THRESHOLD - 0.01 })).toBe(false);
  });
});

describe("deriveYesPrice", () => {
  it("для No (index 1) → дополнение до 1", () => {
    expect(deriveYesPrice(1, 0.15)).toBeCloseTo(0.85, 6);
  });

  it("для Yes (index 0) → как есть", () => {
    expect(deriveYesPrice(0, 0.85)).toBeCloseTo(0.85, 6);
  });
});
