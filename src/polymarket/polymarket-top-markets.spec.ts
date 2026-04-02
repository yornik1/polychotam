import { describe, expect, it } from "vitest";
import type { PolymarketMarketRaw } from "./dto/polymarket-market.raw.js";
import { buildTopMarketsWsSelection, pickTopMarketsByVolume } from "./polymarket-top-markets.js";

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

describe("buildTopMarketsWsSelection", () => {
  it("возвращает rows с рангами и теми же assetIds, что и pickTopMarketsByVolume", () => {
    const markets: PolymarketMarketRaw[] = [
      market({
        condition_id: "0x1",
        market_slug: "slug-b",
        volume24hr: 200,
        tokens: [{ token_id: "tb", outcome: "Yes" }],
      }),
      market({
        condition_id: "0x2",
        market_slug: "slug-a",
        volume24hr: 300,
        tokens: [{ token_id: "ta", outcome: "Yes" }],
      }),
    ];
    const sel = buildTopMarketsWsSelection(markets, 2);
    expect(sel.rows).toHaveLength(2);
    expect(sel.rows[0]?.rank).toBe(1);
    expect(sel.rows[0]?.conditionId).toBe("0x2");
    expect(sel.rows[0]?.slug).toBe("slug-a");
    expect(sel.rows[0]?.volume24hr).toBe(300);
    expect(sel.rows[0]?.tradabilityScore).toBe(2);
    expect(sel.rows[0]?.tokenIds).toEqual(["ta"]);
    expect([...sel.assetIds].sort()).toEqual([...pickTopMarketsByVolume(markets, 2)].sort());
  });

  it("при нулевом объёме сортирует по торгуемости (accepting_orders / active / closed)", () => {
    const markets: PolymarketMarketRaw[] = [
      market({
        condition_id: "0xa",
        volume24hr: 0,
        active: true,
        closed: true,
        tokens: [{ token_id: "ta", outcome: "Yes" }],
      }),
      market({
        condition_id: "0xb",
        volume24hr: 0,
        active: true,
        closed: false,
        accepting_orders: false,
        tokens: [{ token_id: "tb", outcome: "Yes" }],
      }),
      market({
        condition_id: "0xc",
        volume24hr: 0,
        active: true,
        closed: false,
        accepting_orders: true,
        tokens: [{ token_id: "tc", outcome: "Yes" }],
      }),
    ];
    const sel = buildTopMarketsWsSelection(markets, 3);
    expect(sel.rows.map((r) => r.conditionId)).toEqual(["0xc", "0xb", "0xa"]);
    expect(sel.rows[0]?.tradabilityScore).toBe(3);
  });
});
