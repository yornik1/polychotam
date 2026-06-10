import { describe, expect, it } from "vitest";
import { mapGammaCategory } from "./market-category.util.js";
import type { GammaMarketRaw } from "../polymarket/dto/gamma-market.raw.js";

function raw(overrides: Partial<GammaMarketRaw> = {}): GammaMarketRaw {
  return { ...overrides } as GammaMarketRaw;
}

describe("mapGammaCategory", () => {
  // --- Прямое поле category ---

  it("возвращает politics для category=politics", () => {
    expect(mapGammaCategory(raw({ category: "politics" }))).toBe("politics");
  });

  it("возвращает politics для category=election", () => {
    expect(mapGammaCategory(raw({ category: "election" }))).toBe("politics");
  });

  it("возвращает politics для category=geopolitics", () => {
    expect(mapGammaCategory(raw({ category: "geopolitics" }))).toBe("politics");
  });

  it("возвращает sports для category=sports", () => {
    expect(mapGammaCategory(raw({ category: "sports" }))).toBe("sports");
  });

  it("возвращает sports для category=nba", () => {
    expect(mapGammaCategory(raw({ category: "nba" }))).toBe("sports");
  });

  it("возвращает sports для category=nfl", () => {
    expect(mapGammaCategory(raw({ category: "nfl" }))).toBe("sports");
  });

  it("возвращает sports для category=mlb", () => {
    expect(mapGammaCategory(raw({ category: "mlb" }))).toBe("sports");
  });

  it("возвращает sports для category=soccer", () => {
    expect(mapGammaCategory(raw({ category: "soccer" }))).toBe("sports");
  });

  it("возвращает sports для category=epl", () => {
    expect(mapGammaCategory(raw({ category: "epl" }))).toBe("sports");
  });

  it("возвращает crypto для category=crypto", () => {
    expect(mapGammaCategory(raw({ category: "crypto" }))).toBe("crypto");
  });

  it("возвращает crypto для category=bitcoin", () => {
    expect(mapGammaCategory(raw({ category: "bitcoin" }))).toBe("crypto");
  });

  it("возвращает crypto для category=ethereum", () => {
    expect(mapGammaCategory(raw({ category: "ethereum" }))).toBe("crypto");
  });

  it("нормализует регистр category", () => {
    expect(mapGammaCategory(raw({ category: "POLITICS" }))).toBe("politics");
    expect(mapGammaCategory(raw({ category: "NBA" }))).toBe("sports");
    expect(mapGammaCategory(raw({ category: "Bitcoin" }))).toBe("crypto");
  });

  it("возвращает other для неизвестного category", () => {
    expect(mapGammaCategory(raw({ category: "entertainment" }))).toBe("other");
  });

  // --- Tags ---

  it("находит politics в массиве tags", () => {
    expect(mapGammaCategory(raw({ tags: ["us", "politics", "2024"] }))).toBe("politics");
  });

  it("находит sports в массиве tags", () => {
    expect(mapGammaCategory(raw({ tags: ["nba", "playoffs"] }))).toBe("sports");
  });

  it("находит crypto в массиве tags", () => {
    expect(mapGammaCategory(raw({ tags: ["crypto", "defi"] }))).toBe("crypto");
  });

  it("находит категорию в строковом tags", () => {
    expect(mapGammaCategory(raw({ tags: "election" }))).toBe("politics");
  });

  // --- Series ---

  it("находит politics в series", () => {
    expect(mapGammaCategory(raw({ series: "US Election 2024" }))).toBe("politics");
  });

  it("находит sports в series", () => {
    expect(mapGammaCategory(raw({ series: "NBA Season 2024" }))).toBe("sports");
  });

  // --- Slug-эвристика ---

  it("определяет sports по slug с префиксом mlb-", () => {
    expect(mapGammaCategory(raw({ slug: "mlb-world-series-2024" }))).toBe("sports");
  });

  it("определяет sports по slug с префиксом nba-", () => {
    expect(mapGammaCategory(raw({ slug: "nba-finals-winner" }))).toBe("sports");
  });

  it("определяет sports по slug с префиксом nfl-", () => {
    expect(mapGammaCategory(raw({ slug: "nfl-superbowl-2025" }))).toBe("sports");
  });

  it("определяет sports по slug с префиксом nhl-", () => {
    expect(mapGammaCategory(raw({ slug: "nhl-stanley-cup" }))).toBe("sports");
  });

  it("определяет sports по slug с префиксом atp-", () => {
    expect(mapGammaCategory(raw({ slug: "atp-wimbledon-winner" }))).toBe("sports");
  });

  it("определяет sports по slug с префиксом wta-", () => {
    expect(mapGammaCategory(raw({ slug: "wta-us-open" }))).toBe("sports");
  });

  it("определяет sports по slug с префиксом epl-", () => {
    expect(mapGammaCategory(raw({ slug: "epl-title-winner" }))).toBe("sports");
  });

  it("определяет crypto по slug с btc", () => {
    expect(mapGammaCategory(raw({ slug: "btc-price-100k" }))).toBe("crypto");
  });

  it("определяет crypto по slug с bitcoin", () => {
    expect(mapGammaCategory(raw({ slug: "will-bitcoin-reach-200k" }))).toBe("crypto");
  });

  it("определяет crypto по slug с eth", () => {
    expect(mapGammaCategory(raw({ slug: "eth-price-5k-2024" }))).toBe("crypto");
  });

  it("определяет crypto по slug с crypto", () => {
    expect(mapGammaCategory(raw({ slug: "crypto-market-cap-2t" }))).toBe("crypto");
  });

  it("определяет politics по slug с election", () => {
    expect(mapGammaCategory(raw({ slug: "us-election-2024-winner" }))).toBe("politics");
  });

  it("определяет politics по slug с president", () => {
    expect(mapGammaCategory(raw({ slug: "president-approval-rating" }))).toBe("politics");
  });

  it("определяет politics по slug с senate", () => {
    expect(mapGammaCategory(raw({ slug: "senate-majority-2024" }))).toBe("politics");
  });

  it("использует market_slug если slug отсутствует", () => {
    expect(mapGammaCategory(raw({ market_slug: "nba-finals-winner" }))).toBe("sports");
  });

  // --- Edge cases ---

  it("возвращает other для пустого raw", () => {
    expect(mapGammaCategory(raw())).toBe("other");
  });

  it("возвращает other для незнакомого slug", () => {
    expect(mapGammaCategory(raw({ slug: "will-elon-musk-tweet-today" }))).toBe("other");
  });

  it("возвращает other для пустых tags", () => {
    expect(mapGammaCategory(raw({ tags: [] }))).toBe("other");
  });

  it("возвращает other для числового category (не строка)", () => {
    expect(mapGammaCategory(raw({ category: 42 as unknown as string }))).toBe("other");
  });

  it("category имеет приоритет над tags", () => {
    // category=crypto, tags=['election'] → должен вернуть crypto
    expect(mapGammaCategory(raw({ category: "crypto", tags: ["election"] }))).toBe("crypto");
  });

  it("tags имеет приоритет над slug", () => {
    // tags=['crypto'], slug='election-winner' → crypto
    expect(mapGammaCategory(raw({ tags: ["crypto"], slug: "election-winner" }))).toBe("crypto");
  });
});
