import { INestApplication } from "@nestjs/common";
import { getQueueToken, getSharedConfigToken } from "@nestjs/bullmq";
import { Test, TestingModule } from "@nestjs/testing";
import { getDataSourceToken, getEntityManagerToken } from "@nestjs/typeorm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getBotToken } from "nestjs-telegraf";
import { DataSource, EntityManager } from "typeorm";
import { AppModule } from "../src/app.module.js";
import { PolymarketHttpClient } from "../src/polymarket/polymarket-http.client.js";

describe("GET /markets (e2e)", () => {
  let app: INestApplication;
  const envSnapshot: NodeJS.ProcessEnv = { ...process.env };
  const fetchMarkets = vi.fn<() => Promise<unknown[]>>();

  beforeAll(async () => {
    process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:5432/polychotam_test";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.POLYMARKET_WS_URL = "wss://example.com/ws";
    process.env.POLYMARKET_REST_URL = "https://example.com";
    process.env.POLYMARKET_MARKETS_PATH = "/markets";

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

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue({ initialize: vi.fn(), destroy: vi.fn() } as Partial<DataSource>)
      .overrideProvider(getEntityManagerToken())
      .useValue({} as Partial<EntityManager>)
      .overrideProvider(getSharedConfigToken())
      .useValue({ connection: { host: "localhost", port: 6379 } })
      .overrideProvider(getQueueToken("default"))
      .useValue({ add: vi.fn() })
      .overrideProvider(getBotToken())
      .useValue({ launch: vi.fn(), stop: vi.fn(), use: vi.fn() })
      .overrideProvider(PolymarketHttpClient)
      .useValue({ fetchMarkets })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    process.env = { ...envSnapshot };
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
