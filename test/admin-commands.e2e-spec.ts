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
  getRepositoryToken,
} from "@nestjs/typeorm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getBotToken } from "nestjs-telegraf";
import { DataSource, EntityManager } from "typeorm";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { WsConnectionEvent } from "../src/polymarket/ws-connection-event.entity.js";
import { AppModule } from "../src/app.module.js";
import { Market } from "../src/markets/market.entity.js";
import { SmartWallet } from "../src/wallets/smart-wallet.entity.js";
import { WalletPnlSnapshot } from "../src/wallets/wallet-pnl-snapshot.entity.js";
import { WalletScore } from "../src/wallets/wallet-score.entity.js";
import { PolymarketHttpClient } from "../src/polymarket/polymarket-http.client.js";
import { PolymarketWsClient } from "../src/polymarket/polymarket-ws.client.js";
import { Trade } from "../src/trades/trade.entity.js";
import { Wallet } from "../src/wallets/wallet.entity.js";
import { TradesProcessor } from "../src/queue/trades.processor.js";
import { TradeEnrichmentProcessor } from "../src/queue/trade-enrichment.processor.js";
import { WalletAnalyticsProcessor } from "../src/queue/wallet-analytics.processor.js";
import { DataApiClient } from "../src/polymarket/data-api.client.js";
import { TelegramUpdate } from "../src/telegram/telegram.update.js";

const ADMIN_CHAT_ID = "777000";
const NON_ADMIN_CHAT_ID = 999888;

/** Без @Processor — BullMQ Worker в e2e не поднимаем (нет Redis). */
class E2eTradesProcessorStub extends WorkerHost {
  async process(_job: Job): Promise<void> {}
}

describe("Telegram admin-команды (e2e)", () => {
  let app: INestApplication;
  let update: TelegramUpdate;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:5432/polychotam_test");
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    vi.stubEnv("ADMIN_CHAT_ID", ADMIN_CHAT_ID);
    vi.stubEnv("POLYMARKET_WS_URL", "wss://example.com/ws");
    vi.stubEnv("POLYMARKET_REST_URL", "https://example.com");
    vi.stubEnv("POLYMARKET_MARKETS_PATH", "/markets");
    vi.stubEnv("BULL_JOB_ERRORS_LOG_PATH", "");

    const emptyRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockReturnValue({}),
      update: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
        getRawOne: vi.fn().mockResolvedValue({ lastAt: null }),
        getCount: vi.fn().mockResolvedValue(0),
      }),
    };

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
      .useValue(emptyRepo)
      .overrideProvider(getRepositoryToken(Wallet))
      .useValue(emptyRepo)
      .overrideProvider(getRepositoryToken(SmartWallet))
      .useValue(emptyRepo)
      .overrideProvider(getRepositoryToken(WalletPnlSnapshot))
      .useValue(emptyRepo)
      .overrideProvider(getRepositoryToken(WalletScore))
      .useValue(emptyRepo)
      .overrideProvider(getRepositoryToken(AppSetting))
      .useValue({
        findOne: vi.fn().mockResolvedValue({ key: "alerts_enabled", value: "true" }),
        upsert: vi.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(getRepositoryToken(WsConnectionEvent))
      .useValue({
        save: vi.fn().mockResolvedValue(undefined),
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
      })
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
        telegram: { sendMessage: vi.fn().mockResolvedValue({}) },
      })
      .overrideProvider(PolymarketHttpClient)
      .useValue({
        fetchMarkets: vi.fn().mockResolvedValue([]),
        fetchSimplifiedMarkets: vi.fn().mockResolvedValue([]),
        fetchActiveMarketsFromGamma: vi.fn().mockResolvedValue([]),
        fetchRecentlyResolvedMarketsFromGamma: vi.fn().mockResolvedValue([]),
      })
      .overrideProvider(PolymarketWsClient)
      .useValue({ connect: vi.fn(), onModuleDestroy: vi.fn() })
      .overrideProvider(DataApiClient)
      .useValue({
        fetchAllActivity: vi.fn().mockResolvedValue([]),
        fetchPositions: vi.fn().mockResolvedValue([]),
        fetchLbProfit: vi.fn().mockResolvedValue([]),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    update = app.get(TelegramUpdate);
  });

  afterAll(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // Вспомогательная фабрика контекста
  // ---------------------------------------------------------------------------

  function makeCtx(chatId: number | undefined, payload = "") {
    const reply = vi.fn<(msg: string, extra?: unknown) => Promise<unknown>>().mockResolvedValue({});
    return {
      ctx: {
        payload,
        chat: chatId !== undefined ? { id: chatId } : undefined,
        reply,
      },
      reply,
    };
  }

  // ---------------------------------------------------------------------------
  // /queues
  // ---------------------------------------------------------------------------

  describe("/queues", () => {
    it("не отвечает не-admin чату", async () => {
      const { ctx, reply } = makeCtx(NON_ADMIN_CHAT_ID);
      await update.handleQueues(ctx);
      expect(reply).not.toHaveBeenCalled();
    });

    it("отвечает admin-чату", async () => {
      const { ctx, reply } = makeCtx(Number(ADMIN_CHAT_ID));
      await update.handleQueues(ctx);
      expect(reply).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // /errors
  // ---------------------------------------------------------------------------

  describe("/errors", () => {
    it("не отвечает не-admin чату", async () => {
      const { ctx, reply } = makeCtx(NON_ADMIN_CHAT_ID);
      await update.handleErrors(ctx);
      expect(reply).not.toHaveBeenCalled();
    });

    it("отвечает admin-чату", async () => {
      const { ctx, reply } = makeCtx(Number(ADMIN_CHAT_ID));
      await update.handleErrors(ctx);
      expect(reply).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // /ws
  // ---------------------------------------------------------------------------

  describe("/ws", () => {
    it("не отвечает не-admin чату", async () => {
      const { ctx, reply } = makeCtx(NON_ADMIN_CHAT_ID);
      await update.handleWs(ctx);
      expect(reply).not.toHaveBeenCalled();
    });

    it("отвечает admin-чату", async () => {
      const { ctx, reply } = makeCtx(Number(ADMIN_CHAT_ID));
      await update.handleWs(ctx);
      expect(reply).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // /alerts
  // ---------------------------------------------------------------------------

  describe("/alerts", () => {
    it("не отвечает не-admin чату", async () => {
      const { ctx, reply } = makeCtx(NON_ADMIN_CHAT_ID);
      await update.handleAlerts(ctx);
      expect(reply).not.toHaveBeenCalled();
    });

    it("отвечает admin-чату (статус)", async () => {
      const { ctx, reply } = makeCtx(Number(ADMIN_CHAT_ID));
      await update.handleAlerts(ctx);
      expect(reply).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // /start: не содержит admin-команд
  // ---------------------------------------------------------------------------

  describe("/start", () => {
    it("ответ не содержит /queues, /errors, /ws, /alerts", async () => {
      const { ctx, reply } = makeCtx(Number(ADMIN_CHAT_ID));
      await update.handleStart(ctx);
      expect(reply).toHaveBeenCalledOnce();

      const [message] = reply.mock.calls[0] as [string, unknown?];
      const adminCommands = ["/queues", "/errors", "/ws", "/alerts"];
      for (const cmd of adminCommands) {
        expect(message).not.toContain(cmd);
      }
    });
  });
});
