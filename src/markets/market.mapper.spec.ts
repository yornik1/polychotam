import { describe, expect, it } from "vitest";
import { mapPolymarketMarket } from "./market.mapper.js";
import { MarketDto } from "./dto/market.dto.js";
import { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw.js";
import { PolymarketInvalidPayloadError } from "../polymarket/polymarket-http.client.js";

describe("mapPolymarketMarket", () => {
  it("корректно маппит валидный raw market", () => {
    const raw: PolymarketMarketRaw = {
      condition_id: "0xabc123",
      market_slug: "btc-up-down",
      question: "Will BTC be above $100k by year end?",
      tokens: [{ token_id: "t1", outcome: "YES" }, { token_id: "t2", outcome: "NO" }],
      active: true,
      closed: false,
      liquidity: 1500.25,
      volume24hr: 745.5,
      end_date_iso: "2026-12-31T23:59:59Z",
    };

    const mapped: MarketDto = mapPolymarketMarket(raw);

    expect(mapped).toEqual({
      id: "0xabc123",
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

  it("маппит null end_date_iso как null", () => {
    const raw: PolymarketMarketRaw = {
      condition_id: "0xdef456",
      market_slug: "eth-up-down",
      question: "Will ETH be above $5k?",
      tokens: [{ outcome: "YES" }, { outcome: "NO" }],
      active: false,
      closed: true,
      liquidity: 0,
      volume24hr: 0,
      end_date_iso: null,
    };

    const mapped = mapPolymarketMarket(raw);
    expect(mapped.endDate).toBeNull();
  });

  it("подставляет 0 для отсутствующих liquidity и volume24hr", () => {
    const raw: PolymarketMarketRaw = {
      condition_id: "0xmissing-volume",
      market_slug: "sample-market",
      question: "Sample?",
      tokens: [{ outcome: "YES" }, { outcome: "NO" }],
      active: true,
      closed: false,
      liquidity: undefined,
      volume24hr: undefined,
      end_date_iso: null,
    };

    const mapped = mapPolymarketMarket(raw);

    expect(mapped.liquidity).toBe(0);
    expect(mapped.volume24h).toBe(0);
  });

  it("выбрасывает ошибку при структурно невалидных обязательных полях", () => {
    const raw: PolymarketMarketRaw = {
      condition_id: 1001,
      market_slug: null,
      question: ["unexpected", "shape"],
      tokens: ["not-an-object"],
      active: "true",
      closed: "invalid",
      liquidity: "2500.75",
      volume24hr: "not-a-number",
      end_date_iso: "not-a-date",
    };

    expect(() => mapPolymarketMarket(raw)).toThrow(PolymarketInvalidPayloadError);
  });

  it("выбрасывает ошибку если tokens не массив", () => {
    const raw: PolymarketMarketRaw = {
      condition_id: "0xabc",
      market_slug: "test-market",
      question: "Will it happen?",
      tokens: "not-an-array",
      active: true,
      closed: false,
      liquidity: 0,
      volume24hr: 0,
      end_date_iso: null,
    };

    expect(() => mapPolymarketMarket(raw)).toThrow(PolymarketInvalidPayloadError);
  });
});
