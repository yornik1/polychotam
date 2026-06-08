import { describe, expect, it } from "vitest";
import { Market } from "./market.entity.js";
import { MarketScoreService } from "./market-score.service.js";

function createMarket(overrides: Partial<Market> = {}): Market {
  return {
    condition_id: "condition-1",
    question: "Will BTC hit $100k?",
    market_slug: "btc-100k",
    tokens: [
      { outcome: "Yes", price: 0.62 },
      { outcome: "No", price: 0.38 },
    ],
    winning_token_id: null,
    winning_outcome: null,
    active: true,
    closed: false,
    accepting_orders: true,
    liquidity: 75_000,
    volume24hr: 250_000,
    end_date_iso: "2026-12-31T00:00:00Z",
    internal_synced_at: new Date("2026-06-08T00:00:00Z"),
    internal_created_at: new Date("2026-06-08T00:00:00Z"),
    internal_updated_at: new Date("2026-06-08T00:00:00Z"),
    ...overrides,
  } as Market;
}

describe("MarketScoreService", () => {
  const service = new MarketScoreService();

  it("оценивает рынок с достаточными данными и сильными причинами", () => {
    const score = service.scoreMarket(createMarket());

    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.hasEnoughData).toBe(true);
    expect(score.dataGaps).toHaveLength(0);
    expect(score.reasons.length).toBeGreaterThanOrEqual(2);
    expect(score.reasons.length).toBeLessThanOrEqual(4);
    expect(score.conclusion).toBe("strong_watch");
    expect(score.reasons.map((reason) => reason.code)).toContain("high_volume24hr");
    expect(score.reasons.map((reason) => reason.code)).toContain("high_liquidity");
  });

  it("не выдаёт уверенную оценку, когда не хватает рыночных данных", () => {
    const score = service.scoreMarket(
      createMarket({
        tokens: [{ outcome: "Yes" }],
        accepting_orders: null,
        liquidity: 0,
        volume24hr: 0,
        end_date_iso: null,
      }),
    );

    expect(score.hasEnoughData).toBe(false);
    expect(score.conclusion).toBe("insufficient_data");
    expect(score.dataGaps).toContain("missing_prices");
    expect(score.dataGaps).toContain("missing_volume24hr");
    expect(score.score).toBeLessThanOrEqual(50);
  });

  it("отражает закрытый или неактивный рынок как слабый сигнал", () => {
    const score = service.scoreMarket(
      createMarket({
        active: false,
        closed: true,
        accepting_orders: false,
      }),
    );

    expect(score.hasEnoughData).toBe(false);
    expect(score.dataGaps).toContain("not_tradable");
    expect(score.reasons.some((reason) => reason.impact === "negative")).toBe(true);
  });

  it("не считает рынок уверенным, если он не принимает ордера", () => {
    const score = service.scoreMarket(
      createMarket({
        accepting_orders: false,
      }),
    );

    expect(score.hasEnoughData).toBe(false);
    expect(score.conclusion).toBe("insufficient_data");
    expect(score.dataGaps).toContain("not_tradable");
    expect(score.score).toBeLessThanOrEqual(50);
  });

  it("не считает рынок уверенным, если статус приёма ордеров неизвестен", () => {
    const score = service.scoreMarket(
      createMarket({
        accepting_orders: null,
      }),
    );

    expect(score.hasEnoughData).toBe(false);
    expect(score.conclusion).toBe("insufficient_data");
    expect(score.dataGaps).toContain("not_tradable");
  });

  it("держит score в границах 0..100 на экстремальных значениях", () => {
    const high = service.scoreMarket(createMarket({ liquidity: 1_000_000_000, volume24hr: 1_000_000_000 }));
    const low = service.scoreMarket(
      createMarket({ active: false, closed: true, accepting_orders: false, liquidity: -100, volume24hr: -100, tokens: [] }),
    );

    expect(high.score).toBeLessThanOrEqual(100);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });
});
