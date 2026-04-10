import { BadGatewayException, ServiceUnavailableException } from "@nestjs/common";
import {
  PolymarketHttpTimeoutError,
  PolymarketInvalidPayloadError,
  PolymarketUpstreamStatusError,
} from "../polymarket/polymarket-http.client.js";
import { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw.js";
import { Repository } from "typeorm";
import { Market } from "./market.entity.js";
import { MarketsService } from "./markets.service.js";

describe("MarketsService", () => {
  function createService() {
    const fetchMarkets = vi.fn<() => Promise<PolymarketMarketRaw[]>>();
    const findOne = vi.fn();
    const polymarketHttpClient = {
      fetchMarkets,
    };
    const marketRepository = {
      findOne,
    } as Pick<Repository<Market>, "findOne">;
    const service = new MarketsService(
      polymarketHttpClient,
      marketRepository as Repository<Market>,
    );

    return { service, fetchMarkets, findOne };
  }

  it("findBySlug ищет маркет в локальной таблице по market_slug", async () => {
    const { service, findOne } = createService();
    const market = {
      condition_id: "0xmarket1",
      market_slug: "trump-win",
    } as Market;
    findOne.mockResolvedValue(market);

    const result = await service.findBySlug("trump-win");

    expect(findOne).toHaveBeenCalledWith({
      where: { market_slug: "trump-win" },
    });
    expect(result).toBe(market);
  });

  it("маппит 2 маркета и возвращает консистентный meta.total", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockResolvedValue([
      {
        condition_id: "0xmarket1",
        market_slug: "btc-above-100k",
        question: "Will BTC be above $100k?",
        tokens: [{ outcome: "YES" }, { outcome: "NO" }],
        active: true,
        closed: false,
        liquidity: "1500.5",
        volume24hr: 100,
        end_date_iso: "2026-12-31T23:59:59Z",
      },
      {
        condition_id: "0xmarket2",
        market_slug: "eth-above-5k",
        question: "Will ETH be above $5k?",
        tokens: [{ outcome: "YES" }, { outcome: "NO" }],
        active: false,
        closed: true,
        liquidity: 2500,
        volume24hr: "210.4",
        end_date_iso: "2026-11-30T12:00:00Z",
      },
    ]);

    const result = await service.getMarkets();

    expect(result.data).toEqual([
      {
        id: "0xmarket1",
        slug: "btc-above-100k",
        question: "Will BTC be above $100k?",
        outcomes: ["YES", "NO"],
        active: true,
        closed: false,
        liquidity: 1500.5,
        volume24h: 100,
        endDate: "2026-12-31T23:59:59.000Z",
      },
      {
        id: "0xmarket2",
        slug: "eth-above-5k",
        question: "Will ETH be above $5k?",
        outcomes: ["YES", "NO"],
        active: false,
        closed: true,
        liquidity: 2500,
        volume24h: 210.4,
        endDate: "2026-11-30T12:00:00.000Z",
      },
    ]);
    expect(result.meta.source).toBe("polymarket");
    expect(result.meta.total).toBe(2);
    expect(result.meta.total).toBe(result.data.length);
    expect(new Date(result.meta.fetchedAt).toISOString()).toBe(result.meta.fetchedAt);
  });

  it("вызывает upstream fetchMarkets ровно один раз за один getMarkets", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockResolvedValue([
      {
        condition_id: "0xmarket1",
        market_slug: "btc-above-100k",
        question: "Will BTC be above $100k?",
        tokens: [{ outcome: "YES" }, { outcome: "NO" }],
        active: true,
        closed: false,
        liquidity: "1500.5",
        volume24hr: 100,
        end_date_iso: "2026-12-31T23:59:59Z",
      },
    ]);

    await service.getMarkets();

    expect(fetchMarkets).toHaveBeenCalledTimes(1);
  });

  it("преобразует timeout в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockRejectedValue(new PolymarketHttpTimeoutError());

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
  });

  it("преобразует 429 в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockRejectedValue(new PolymarketUpstreamStatusError(429));

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  });

  it("преобразует 500 в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockRejectedValue(new PolymarketUpstreamStatusError(500));

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  });

  it("преобразует 400 в 502", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockRejectedValue(new PolymarketUpstreamStatusError(400));

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getStatus()).toBe(502);
  });

  it("преобразует невалидный payload в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockRejectedValue(new PolymarketInvalidPayloadError());

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  });

  it("преобразует не-массив payload в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockResolvedValue({ condition_id: "not-array" } as unknown as PolymarketMarketRaw[]);

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
  });

  it("преобразует структурно невалидный market item в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockResolvedValue([
      {
        condition_id: 1001,
        market_slug: "btc-above-100k",
        question: "Will BTC be above $100k?",
        tokens: [{ outcome: "YES" }, { outcome: "NO" }],
        active: true,
        closed: false,
        liquidity: "1500.5",
        volume24hr: 100,
        end_date_iso: "2026-12-31T23:59:59Z",
      },
    ]);

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  });

  it("пропускает невалидные элементы и возвращает валидные", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockResolvedValue([
      {
        condition_id: "",
        market_slug: "broken-market",
        question: "Broken?",
        tokens: [{ outcome: "YES" }, { outcome: "NO" }],
        active: true,
        closed: false,
        liquidity: 0,
        volume24hr: 0,
        end_date_iso: null,
      },
      {
        condition_id: "0xok",
        market_slug: "valid-market",
        question: "Valid?",
        tokens: [{ outcome: "YES" }, { outcome: "NO" }],
        active: true,
        closed: false,
        liquidity: 1,
        volume24hr: 2,
        end_date_iso: "2026-12-31T23:59:59Z",
      },
    ]);

    const result = await service.getMarkets();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe("0xok");
    expect(result.meta.total).toBe(1);
  });

  it("преобразует неожиданную ошибку в 503", async () => {
    const { service, fetchMarkets } = createService();
    fetchMarkets.mockRejectedValue(new Error("Unexpected crash"));

    const error = await service.getMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
  });
});
