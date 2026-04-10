import { INestApplication } from "@nestjs/common";
import {
  getQueueToken,
  getSharedConfigToken,
  WorkerHost,
} from "@nestjs/bullmq";
import { Test, TestingModule } from "@nestjs/testing";
import type { Job } from "bullmq";
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
import { TradesProcessor } from "../src/queue/trades.processor.js";
import { TradeEnrichmentProcessor } from "../src/queue/trade-enrichment.processor.js";
import { WalletAnalyticsProcessor } from "../src/queue/wallet-analytics.processor.js";

/** Без @Processor — BullMQ Worker в e2e не поднимаем (нет Redis). */
class E2eTradesProcessorStub extends WorkerHost {
  async process(_job: Job): Promise<void> {}
}

describe("GET /markets (e2e)", () => {
  let app: INestApplication;
  const fetchMarkets = vi.fn<() => Promise<unknown[]>>();
  const fetchSimplifiedMarkets = vi.fn<() => Promise<unknown[]>>();

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:5432/polychotam_test");
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
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

    fetchSimplifiedMarkets.mockResolvedValue([
      {
        condition_id: "0xmarket1",
        tokens: [
          { token_id: "token-yes", outcome: "YES", winner: false },
          { token_id: "token-no", outcome: "NO", winner: false },
        ],
        active: true,
        closed: false,
        accepting_orders: true,
        archived: false,
      },
    ]);

    const emptyRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
    } as Partial<Repository<Market>>;

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
      .overrideProvider(getQueueToken("trades"))
      .useValue({
        add: vi.fn(),
        name: "trades",
        metaValues: { version: "bullmq" },
        client: Promise.resolve({ info: vi.fn().mockResolvedValue("") }),
        getJobCounts: vi.fn().mockResolvedValue({}),
      })
      .overrideProvider(getQueueToken("wallet-analytics"))
      .useValue({
        add: vi.fn(),
        name: "wallet-analytics",
        metaValues: { version: "bullmq" },
        client: Promise.resolve({ info: vi.fn().mockResolvedValue("") }),
        getJobCounts: vi.fn().mockResolvedValue({}),
      })
      .overrideProvider(getQueueToken("trade-enrichment"))
      .useValue({
        add: vi.fn(),
        name: "trade-enrichment",
        metaValues: { version: "bullmq" },
        client: Promise.resolve({ info: vi.fn().mockResolvedValue("") }),
        getJobCounts: vi.fn().mockResolvedValue({}),
      })
      .overrideProvider(TradesProcessor)
      .useClass(E2eTradesProcessorStub)
      .overrideProvider(TradeEnrichmentProcessor)
      .useClass(E2eTradesProcessorStub)
      .overrideProvider(WalletAnalyticsProcessor)
      .useClass(E2eTradesProcessorStub)
      .overrideProvider(getBotToken())
      .useValue({
        launch: vi.fn(),
        stop: vi.fn(),
        use: vi.fn(),
        start: vi.fn(),
        command: vi.fn(),
        catch: vi.fn(),
        telegram: { sendMessage: vi.fn() },
      })
      .overrideProvider(PolymarketHttpClient)
      .useValue({ fetchMarkets, fetchSimplifiedMarkets })
      .overrideProvider(PolymarketWsClient)
      .useValue({ connect: vi.fn(), onModuleDestroy: vi.fn() })
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
