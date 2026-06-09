import { describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import type { PolymarketHttpClient } from "../polymarket/polymarket-http.client.js";
import type { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw.js";
import type { PolymarketSimplifiedMarketRaw } from "../polymarket/dto/polymarket-simplified-market.raw.js";
import { Market } from "./market.entity.js";
import { MarketSyncService } from "./market-sync.service.js";

describe("MarketSyncService", () => {
  it("сохраняет winning token и outcome для resolved market", async () => {
    const fetchMarkets = vi.fn<() => Promise<PolymarketMarketRaw[]>>().mockResolvedValue([
      {
        condition_id: "0xresolved",
        market_slug: "resolved-market",
        question: "Resolved market?",
        tokens: [
          { token_id: "token-yes", outcome: "YES" },
          { token_id: "token-no", outcome: "NO" },
        ],
        active: false,
        closed: true,
        accepting_orders: false,
        liquidity: 0,
        volume24hr: 10,
        end_date_iso: "2026-12-31T00:00:00Z",
      },
    ]);
    const fetchSimplifiedMarkets =
      vi.fn<() => Promise<PolymarketSimplifiedMarketRaw[]>>().mockResolvedValue([
        {
          condition_id: "0xresolved",
          tokens: [
            { token_id: "token-yes", outcome: "YES", winner: true },
            { token_id: "token-no", outcome: "NO", winner: false },
          ],
          active: false,
          closed: true,
          archived: false,
          accepting_orders: false,
        },
      ]);
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new MarketSyncService(
      {
        fetchMarkets,
        fetchSimplifiedMarkets,
      } as unknown as PolymarketHttpClient,
      { upsert } as unknown as Repository<Market>,
    );

    await service.syncSnapshot();

    expect(fetchMarkets).toHaveBeenCalledTimes(1);
    expect(fetchSimplifiedMarkets).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          condition_id: "0xresolved",
          market_slug: "resolved-market",
          winning_token_id: "token-yes",
          winning_outcome: "YES",
          internal_synced_at: expect.any(Date),
        }),
      ],
      ["condition_id"],
    );
  });

  it("сохраняет null winner поля если resolved token не найден", async () => {
    const fetchMarkets = vi.fn<() => Promise<PolymarketMarketRaw[]>>().mockResolvedValue([
      {
        condition_id: "0xopen",
        market_slug: "open-market",
        question: "Open market?",
        tokens: [
          { token_id: "token-yes", outcome: "YES" },
          { token_id: "token-no", outcome: "NO" },
        ],
        active: true,
        closed: false,
        accepting_orders: true,
        liquidity: 1,
        volume24hr: 2,
        end_date_iso: null,
      },
    ]);
    const fetchSimplifiedMarkets =
      vi.fn<() => Promise<PolymarketSimplifiedMarketRaw[]>>().mockResolvedValue([
        {
          condition_id: "0xopen",
          tokens: [
            { token_id: "token-yes", outcome: "YES", winner: false },
            { token_id: "token-no", outcome: "NO", winner: false },
          ],
          active: true,
          closed: false,
          archived: false,
          accepting_orders: true,
        },
      ]);
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new MarketSyncService(
      {
        fetchMarkets,
        fetchSimplifiedMarkets,
      } as unknown as PolymarketHttpClient,
      { upsert } as unknown as Repository<Market>,
    );

    await service.syncSnapshot();

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          condition_id: "0xopen",
          winning_token_id: null,
          winning_outcome: null,
        }),
      ],
      ["condition_id"],
    );
  });

  it("дедуплицирует маркеты по condition_id перед bulk upsert", async () => {
    const fetchMarkets = vi.fn<() => Promise<PolymarketMarketRaw[]>>().mockResolvedValue([
      {
        condition_id: "0xdup",
        market_slug: "first-market",
        question: "First version?",
        tokens: [{ token_id: "token-yes", outcome: "YES" }],
        active: true,
        closed: false,
        accepting_orders: true,
        liquidity: 1,
        volume24hr: 2,
        end_date_iso: null,
      },
      {
        condition_id: "0xdup",
        market_slug: "second-market",
        question: "Second version?",
        tokens: [{ token_id: "token-yes", outcome: "YES" }],
        active: false,
        closed: true,
        accepting_orders: false,
        liquidity: 10,
        volume24hr: 20,
        end_date_iso: "2026-12-31T00:00:00Z",
      },
    ]);
    const fetchSimplifiedMarkets =
      vi.fn<() => Promise<PolymarketSimplifiedMarketRaw[]>>().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new MarketSyncService(
      {
        fetchMarkets,
        fetchSimplifiedMarkets,
      } as unknown as PolymarketHttpClient,
      { upsert } as unknown as Repository<Market>,
    );

    await service.syncSnapshot();

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          condition_id: "0xdup",
          market_slug: "second-market",
          question: "Second version?",
        }),
      ],
      ["condition_id"],
    );
  });

  it("upsertGammaMarketsAndCollectNewlyResolved возвращает id при новом winning_token", async () => {
    const fetchMarkets = vi.fn();
    const fetchSimplifiedMarkets = vi.fn();
    const find = vi.fn().mockResolvedValue([
      { condition_id: "0xg", closed: false, winning_token_id: null },
    ]);
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new MarketSyncService(
      {
        fetchMarkets,
        fetchSimplifiedMarkets,
      } as unknown as PolymarketHttpClient,
      { find, upsert } as unknown as Repository<Market>,
    );

    const newly = await service.upsertGammaMarketsAndCollectNewlyResolved([
      {
        conditionId: "0xg",
        slug: "slug-g",
        question: "Q?",
        clobTokenIds: ["tok-a", "tok-b"],
        outcomes: '["Yes","No"]',
        outcomePrices: '["1","0"]',
        closed: true,
        active: false,
        volume24hr: 1,
        liquidityNum: 0,
      },
    ]);

    expect(newly).toEqual(["0xg"]);
    expect(upsert).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          tokens: [
            { token_id: "tok-a", outcome: "Yes", price: "1" },
            { token_id: "tok-b", outcome: "No", price: "0" },
          ],
        }),
      ],
      ["condition_id"],
    );
  });

  it("upsertGammaMarketsAndCollectNewlyResolved пустой массив если winner уже был в БД", async () => {
    const fetchMarkets = vi.fn();
    const fetchSimplifiedMarkets = vi.fn();
    const find = vi.fn().mockResolvedValue([
      { condition_id: "0xg", closed: true, winning_token_id: "tok-a" },
    ]);
    const upsert = vi.fn().mockResolvedValue(undefined);

    const service = new MarketSyncService(
      {
        fetchMarkets,
        fetchSimplifiedMarkets,
      } as unknown as PolymarketHttpClient,
      { find, upsert } as unknown as Repository<Market>,
    );

    const newly = await service.upsertGammaMarketsAndCollectNewlyResolved([
      {
        conditionId: "0xg",
        slug: "slug-g",
        question: "Q?",
        clobTokenIds: ["tok-a", "tok-b"],
        outcomes: '["Yes","No"]',
        outcomePrices: '["1","0"]',
        closed: true,
        active: false,
        volume24hr: 1,
        liquidityNum: 0,
      },
    ]);

    expect(newly).toEqual([]);
  });
});
