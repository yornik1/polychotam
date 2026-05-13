import { describe, expect, it } from "vitest";
import { buildTopMarketsWsSelectionFromGamma } from "./polymarket-gamma-top-markets.js";

describe("buildTopMarketsWsSelectionFromGamma", () => {
  it("сортирует по volume24hr и собирает уникальные token id", () => {
    const selection = buildTopMarketsWsSelectionFromGamma(
      [
        {
          conditionId: "0xlow",
          slug: "a",
          question: "a",
          clobTokenIds: ["t1"],
          volume24hr: 10,
          active: true,
          closed: false,
        },
        {
          conditionId: "0xhigh",
          slug: "b",
          question: "b",
          clobTokenIds: ["t2", "t3"],
          volume24hr: 99,
          active: true,
          closed: false,
        },
      ],
      2,
    );
    expect(selection.rows[0]!.conditionId).toBe("0xhigh");
    expect(selection.rows[1]!.conditionId).toBe("0xlow");
    expect([...selection.assetIds].sort()).toEqual([...["t1", "t2", "t3"]].sort());
  });
});
