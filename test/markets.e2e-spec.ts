import { INestApplication } from "@nestjs/common";
import { getQueueToken, getSharedConfigToken } from "@nestjs/bullmq";
import { Test, TestingModule } from "@nestjs/testing";
import {
  getDataSourceToken,
  getEntityManagerToken,
  getRepositoryToken
} from "@nestjs/typeorm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getBotToken } from "nestjs-telegraf";
import { DataSource, EntityManager, Repository } from "typeorm";
import { AppModule } from "../src/app.module.js";
import { Market } from "../src/markets/market.entity.js";
import { PolymarketHttpClient } from "../src/polymarket/polymarket-http.client.js";
import { PolymarketWsClient } from "../src/polymarket/polymarket-ws.client.js";
import { Trade } from "../src/trades/trade.entity.js";
import { Wallet } from "../src/wallets/wallet.entity.js";

describe("GET /markets (e2e)", () => {
  let app: INestApplication;
  const fetchMarkets = vi.fn<() => Promise<unknown[]>>();

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:5432/polychotam_test");
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("POLYMARKET_WS_URL", "wss://example.com/ws");
    vi.stubEnv("POLYMARKET_REST_URL", "https://example.com");
    vi.stubEnv("POLYMARKET_MARKETS_PATH", "/markets");

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

    const emptyRepo = {} as Repository<Market>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue({ initialize: vi.fn(), destroy: vi.fn() } as Partial<DataSource>)
      .overrideProvider(getEntityManagerToken())
      .useValue({} as Partial<EntityManager>)
      .overrideProvider(getRepositoryToken(Market))
      .useValue(emptyRepo)
      .overrideProvider(getRepositoryToken(Trade))
      .useValue(emptyRepo as Repository<Trade>)
      .overrideProvider(getRepositoryToken(Wallet))
      .useValue(emptyRepo as Repository<Wallet>)
      .overrideProvider(getSharedConfigToken())
      .useValue({ connection: { host: "localhost", port: 6379 } })
      .overrideProvider(getQueueToken("default"))
      .useValue({ add: vi.fn() })
      .overrideProvider(getBotToken())
      .useValue({ launch: vi.fn(), stop: vi.fn(), use: vi.fn() })
      .overrideProvider(PolymarketHttpClient)
      .useValue({ fetchMarkets })
      .overrideProvider(PolymarketWsClient)
      .useValue({ onModuleInit: vi.fn(), onModuleDestroy: vi.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    vi.unstubAllEnvs();
  });

  it("returns 200 with data and meta", async () => {
    const response = await request(app.getHttpServer()).get("/markets");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: expect.any(Array),
      meta: {
        source: "polymarket",
        total: 1,
        fetchedAt: expect.any(String),
      },
    });
    expect(response.body.meta.fetchedAt).toBe(new Date(response.body.meta.fetchedAt).toISOString());
  });
});
