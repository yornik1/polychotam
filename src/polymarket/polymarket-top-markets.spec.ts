import { describe, expect, it } from "vitest";
import type { PolymarketMarketRaw } from "./dto/polymarket-market.raw.js";
import { pickTopMarketsByVolume } from "./polymarket-top-markets.js";

function market(partial: Partial<PolymarketMarketRaw> & { condition_id: string; tokens: unknown }): PolymarketMarketRaw {
  return {
    question: "",
    market_slug: "",
    active: true,
    closed: false,
    liquidity: 0,
    volume24hr: 0,
    end_date_iso: null,
    ...partial,
  };
}

describe("pickTopMarketsByVolume", () => {
  it("возвращает token_id топ-2 рынков по объёму", () => {
    const markets: PolymarketMarketRaw[] = [
      market({
        condition_id: "0xaa",
        volume24hr: 10,
        tokens: [{ token_id: "t1", outcome: "Yes" }],
      }),
      market({
        condition_id: "0xbb",
        volume24hr: 100,
        tokens: [{ token_id: "t2", outcome: "Yes" }],
      }),
      market({
        condition_id: "0xcc",
        volume24hr: 50,
        tokens: [{ token_id: "t3", outcome: "Yes" }],
      }),
    ];
    const ids = pickTopMarketsByVolume(markets, 2);
    expect(ids).toEqual(["t2", "t3"]);
  });

  it("пропускает рынки без condition_id или без token_id", () => {
    const markets: PolymarketMarketRaw[] = [
      market({
        condition_id: "",
        volume24hr: 999,
        tokens: [{ token_id: "x", outcome: "Yes" }],
      }),
      market({
        condition_id: "0xok",
        volume24hr: 1,
        tokens: [{ token_id: "keep", outcome: "Yes" }],
      }),
    ];
    expect(pickTopMarketsByVolume(markets, 5)).toEqual(["keep"]);
  });

  it("при равном объёме сохраняет порядок по исходному индексу", () => {
    const markets: PolymarketMarketRaw[] = [
      market({
        condition_id: "0xa",
        volume24hr: 5,
        tokens: [{ token_id: "a1", outcome: "Yes" }],
      }),
      market({
        condition_id: "0xb",
        volume24hr: 5,
        tokens: [{ token_id: "b1", outcome: "Yes" }],
      }),
    ];
    expect(pickTopMarketsByVolume(markets, 2)).toEqual(["a1", "b1"]);
  });

  it("собирает оба token_id у одного рынка", () => {
    const markets: PolymarketMarketRaw[] = [
      market({
        condition_id: "0xm",
        volume24hr: 1,
        tokens: [
          { token_id: "yes", outcome: "Yes" },
          { token_id: "no", outcome: "No" },
        ],
      }),
    ];
    const ids = pickTopMarketsByVolume(markets, 1);
    expect(ids.sort()).toEqual(["no", "yes"]);
  });
});
