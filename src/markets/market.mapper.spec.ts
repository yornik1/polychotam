import { describe, expect, it } from "vitest";
import { mapPolymarketMarket } from "./market.mapper";
import { MarketDto } from "./dto/market.dto";
import { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw";
import { PolymarketInvalidPayloadError } from "../polymarket/polymarket-http.client";

describe("mapPolymarketMarket", () => {
  it("корректно маппит валидный raw market", () => {
    const raw: PolymarketMarketRaw = {
      id: "market-1",
      slug: "btc-up-down",
      question: "Will BTC be above $100k by year end?",
      outcomes: ["YES", "NO"],
      active: true,
      closed: false,
      liquidity: 1500.25,
      volume24h: 745.5,
      endDate: "2026-12-31T23:59:59Z",
    };

    const mapped: MarketDto = mapPolymarketMarket(raw);

    expect(mapped).toEqual({
      id: "market-1",
      slug: "btc-up-down",
      question: "Will BTC be above $100k by year end?",
      outcomes: ["YES", "NO"],
      active: true,
      closed: false,
      liquidity: 1500.25,
      volume24h: 745.5,
      endDate: "2026-12-31T23:59:59.000Z",
    });
  });

  it("выбрасывает ошибку при структурно невалидных обязательных полях", () => {
    const raw: PolymarketMarketRaw = {
      id: 1001,
      slug: null,
      question: ["unexpected", "shape"],
      outcomes: ["YES", 1, null, "NO"],
      active: "true",
      closed: "invalid",
      liquidity: "2500.75",
      volume24h: "not-a-number",
      endDate: "not-a-date",
    };

    expect(() => mapPolymarketMarket(raw)).toThrow(PolymarketInvalidPayloadError);
  });
});
