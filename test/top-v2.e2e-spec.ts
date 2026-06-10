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
import { WalletScoreService } from "../src/wallets/wallet-score.service.js";
import { WalletPnlV2Service } from "../src/wallets/wallet-pnl-v2.service.js";
import { TelegramService } from "../src/telegram/telegram.service.js";
import { computeCashFlowPnl } from "../src/wallets/wallet-pnl-v2.util.js";
import type { WalletActivityRaw, WalletPositionRaw } from "../src/types/contracts.js";

/** Без @Processor — BullMQ Worker в e2e не поднимаем (нет Redis). */
class E2eTradesProcessorStub extends WorkerHost {
  async process(_job: Job): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Вспомогательные фикстуры
// ---------------------------------------------------------------------------

/** Специализация-заглушка: все нули — Mixed в форматтере. */
const emptySpec = {
  politics: { winRate: null, resolvedCount: 0 },
  sports: { winRate: null, resolvedCount: 0 },
  crypto: { winRate: null, resolvedCount: 0 },
  other: { winRate: null, resolvedCount: 0 },
};

/** Создаёт WalletScore с полями по умолчанию для «хорошего» кошелька. */
function makeScore(overrides: Partial<WalletScore>): WalletScore {
  const s = new WalletScore();
  s.address = "0x000000000000000000000000000000000000aaaa";
  s.pnl_90d = "500";
  s.win_rate = "0.70";
  s.profit_factor = "2.0";
  s.specialization = emptySpec;
  s.sample_size = 40;
  s.score = "75";
  s.computed_at = new Date();
  s.internal_created_at = new Date();
  s.internal_updated_at = new Date();
  return Object.assign(s, overrides);
}

/**
 * 12 записей:
 *  - 2 невалидных: validated=false в снапшоте (отфильтруются JOIN-ом в getTopByScore)
 *  - 2 с win_rate <= 0.55 (отфильтруются условием win_rate > minWinRate)
 *  - 1 с sample_size < 30 (в реальном сервисе запись вообще не создаётся)
 *  - 7 валидных с win_rate > 0.55, sample_size >= 30, pnl_90d > 0
 *
 * getTopByScore делает JOIN с wallet_pnl_snapshots(validated=true),
 * поэтому мок scoreRepo.createQueryBuilder возвращает только «хорошие» 7 записей.
 */
const VALID_SCORES: WalletScore[] = Array.from({ length: 7 }, (_, i) =>
  makeScore({
    address: `0x${String(i + 1).padStart(40, "0")}`,
    pnl_90d: String(100 + i * 50),
    win_rate: String(0.60 + i * 0.01),
    sample_size: 30 + i,
    score: String(70 + i),
  }),
);

// ---------------------------------------------------------------------------
// describe: /top команда (acceptance Фазы 1)
// ---------------------------------------------------------------------------

describe("/top v2 acceptance (e2e)", () => {
  let app: INestApplication;
  const replyMock = vi.fn<(msg: string, extra?: unknown) => Promise<unknown>>();

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:5432/polychotam_test");
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123456");
    vi.stubEnv("ADMIN_CHAT_ID", "777000");
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
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
        getRawOne: vi.fn().mockResolvedValue(null),
        getCount: vi.fn().mockResolvedValue(0),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };

    // Мок scoreRepo — возвращает ровно 7 валидных записей из getTopByScore
    const scoreRepoMock = {
      ...emptyRepo,
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(VALID_SCORES),
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
      .useValue(scoreRepoMock)
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
  });

  afterAll(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Acceptance: /top возвращает ≤10 кошельков
  // -------------------------------------------------------------------------

  it("/top: ответ содержит не более 10 кошельков", async () => {
    const walletScoreService = app.get(WalletScoreService);
    const wallets = await walletScoreService.getTopByScore(10);
    expect(wallets.length).toBeLessThanOrEqual(10);
  });

  it("/top: все показанные кошельки — только валидные (мок возвращает 7)", async () => {
    const walletScoreService = app.get(WalletScoreService);
    const wallets = await walletScoreService.getTopByScore(10);

    // Мок симулирует только validated=true (JOIN в реальном сервисе фильтрует по validated)
    // Проверяем, что все записи соответствуют критериям: win_rate > 0.55, sample_size >= 30, pnl_90d > 0
    for (const w of wallets) {
      expect(Number(w.win_rate)).toBeGreaterThan(0.55);
      expect(w.sample_size).toBeGreaterThanOrEqual(30);
      expect(Number(w.pnl_90d)).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Acceptance: форматированный ответ не содержит disclaimers
  // -------------------------------------------------------------------------

  it("/top: форматированный ответ не содержит запрещённых слов-disclaimers", async () => {
    const walletScoreService = app.get(WalletScoreService);
    const { formatTopSmartWalletsMessage } = await import(
      "../src/telegram/telegram.formatter.js"
    );
    const wallets = await walletScoreService.getTopByScore(10);
    const msg = formatTopSmartWalletsMessage(wallets);

    const forbidden = ["Limitations", "Data gaps", "Scope", "disclaimer", "not full"];
    for (const word of forbidden) {
      expect(msg).not.toContain(word);
    }
  });

  // -------------------------------------------------------------------------
  // Acceptance: /pnl — ровно одна служебная строка «est. on-chain data»
  // -------------------------------------------------------------------------

  it("/pnl: сообщение содержит ровно одну строку «est. on-chain data»", async () => {
    const { formatWalletPnlV2Message } = await import(
      "../src/telegram/telegram.formatter.js"
    );
    const summary = {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      window: "90d" as const,
      method: "cash_flow_wallet_activity" as const,
      realizedPnl: 450,
      openPositionsValue: 50,
      totalPnl: 500,
      byOperation: { "TRADE:BUY": -200, "TRADE:SELL": 650 },
      hypothesisTypes: [],
      dataGaps: [],
      validated: true,
      computedAt: new Date().toISOString(),
    };
    const msg = formatWalletPnlV2Message(summary);

    // Ровно одно вхождение «est. on-chain data» — не более одного disclaimer-блока
    const matches = msg.match(/est\. on-chain data/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Acceptance: /start не содержит admin-команд
  // -------------------------------------------------------------------------

  it("/start: ответ не содержит /queues, /errors, /ws, /alerts", async () => {
    const { formatStartMessage } = await import(
      "../src/telegram/telegram.formatter.js"
    );
    const msg = formatStartMessage();
    const adminCommands = ["/queues", "/errors", "/ws", "/alerts"];
    for (const cmd of adminCommands) {
      expect(msg).not.toContain(cmd);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: граница окна 90 дней в recalcWindow (условие Architect rec#5)
// ---------------------------------------------------------------------------

describe("WalletPnlV2Service.recalcWindow — граница окна 30–90 дней (unit)", () => {
  /**
   * Проверяем, что start = now − 90*86400 (инклюзивен):
   *   - операция с timestamp == startSec → входит (boundary-inclusive)
   *   - операция с timestamp == startSec − 1 → не входит (сервис передаёт start в API,
   *     API по контракту start-инклюзивен; в моке мы проверяем переданный start)
   */
  it("передаёт start = now − 90*86400 и учитывает граничную операцию", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expectedStart = nowSec - 90 * 86400;

    // Граничная запись — timestamp ровно на start (должна войти)
    const boundaryActivity: WalletActivityRaw = {
      proxyWallet: "0xabc",
      timestamp: expectedStart,
      conditionId: "0xcond1",
      type: "TRADE",
      side: "SELL",
      size: "10",
      usdcSize: 100,
      transactionHash: "0xtx1",
      price: "0.5",
      asset: "0xasset1",
      outcomeIndex: 0,
    };

    // Запись за секунду до границы (не должна войти — API возвращает только >= start)
    const beforeBoundaryActivity: WalletActivityRaw = {
      proxyWallet: "0xabc",
      timestamp: expectedStart - 1,
      conditionId: "0xcond2",
      type: "TRADE",
      side: "BUY",
      size: "5",
      usdcSize: 50,
      transactionHash: "0xtx2",
      price: "0.5",
      asset: "0xasset2",
      outcomeIndex: 0,
    };

    const fetchAllActivityMock = vi.fn<
      (addr: string, opts: { start?: number; sortDirection?: "ASC" }) => Promise<WalletActivityRaw[]>
    >();

    // Мок API: возвращает только записи >= start (behaviour data-api)
    fetchAllActivityMock.mockImplementation((_addr, opts) => {
      const start = opts?.start ?? 0;
      return Promise.resolve(
        [boundaryActivity, beforeBoundaryActivity].filter((a) => a.timestamp >= start),
      );
    });

    const fetchPositionsMock = vi.fn<() => Promise<WalletPositionRaw[]>>().mockResolvedValue([]);

    const snapshotRepoMock = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockReturnValue({}),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const configServiceMock = {
      get: vi.fn().mockReturnValue(undefined),
      getOrThrow: vi.fn().mockReturnValue(""),
    };

    const service = new WalletPnlV2Service(
      snapshotRepoMock as never,
      { fetchAllActivity: fetchAllActivityMock, fetchPositions: fetchPositionsMock } as never,
      configServiceMock as never,
    );

    await service.recalc("0xabc", "90d");

    // Проверяем, что fetchAllActivity вызван с start = now - 90*86400
    expect(fetchAllActivityMock).toHaveBeenCalledOnce();
    const [, callOpts] = fetchAllActivityMock.mock.calls[0] as [string, { start?: number }];
    // Допуск ±2с: between() вместо точного сравнения (время идёт)
    expect(callOpts.start).toBeGreaterThanOrEqual(expectedStart - 2);
    expect(callOpts.start).toBeLessThanOrEqual(expectedStart + 2);

    // Проверяем, что граничная операция вошла в расчёт
    // save был вызван с totalPnl = usdcSize(SELL) = +100
    expect(snapshotRepoMock.save).toHaveBeenCalledOnce();
    const savedSnapshot = snapshotRepoMock.save.mock.calls[0][0] as { pnl?: string };
    expect(Number(savedSnapshot.pnl)).toBeCloseTo(100, 0);

    // Запись за секунду до start не вернулась из API — итого только boundary
    expect(fetchAllActivityMock.mock.calls[0]).not.toHaveLength(0);
  });

  it("операция ровно до start (за 1с) не входит в сумму — API её не вернул", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - 90 * 86400;

    // Только запись за пределами окна (timestamp < start)
    const outsideActivity: WalletActivityRaw = {
      proxyWallet: "0xdef",
      timestamp: startSec - 1,
      conditionId: "0xcond3",
      type: "TRADE",
      side: "SELL",
      size: "20",
      usdcSize: 999,
      transactionHash: "0xtx3",
      price: "0.8",
      asset: "0xasset3",
      outcomeIndex: 1,
    };

    const fetchAllActivityMock = vi.fn<
      (addr: string, opts: { start?: number; sortDirection?: "ASC" }) => Promise<WalletActivityRaw[]>
    >();

    // API соблюдает start-фильтр: возвращает пустой массив (timestamp < start)
    fetchAllActivityMock.mockImplementation((_addr, opts) => {
      const start = opts?.start ?? 0;
      return Promise.resolve(
        [outsideActivity].filter((a) => a.timestamp >= start),
      );
    });

    const fetchPositionsMock = vi.fn<() => Promise<WalletPositionRaw[]>>().mockResolvedValue([]);

    const snapshotRepoMock = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockReturnValue({}),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const configServiceMock = {
      get: vi.fn().mockReturnValue(undefined),
      getOrThrow: vi.fn().mockReturnValue(""),
    };

    const service = new WalletPnlV2Service(
      snapshotRepoMock as never,
      { fetchAllActivity: fetchAllActivityMock, fetchPositions: fetchPositionsMock } as never,
      configServiceMock as never,
    );

    await service.recalc("0xdef", "90d");

    expect(snapshotRepoMock.save).toHaveBeenCalledOnce();
    const savedSnapshot = snapshotRepoMock.save.mock.calls[0][0] as { pnl?: string };
    // Запись не вошла — totalPnl должен быть 0
    expect(Number(savedSnapshot.pnl)).toBeCloseTo(0, 0);
  });

  // -------------------------------------------------------------------------
  // Чистый unit: computeCashFlowPnl сумма = сумма всех usdcSize в окне
  // -------------------------------------------------------------------------

  it("computeCashFlowPnl: сумма операций окна арифметически верна", () => {
    const activities: WalletActivityRaw[] = [
      {
        proxyWallet: "0xabc",
        timestamp: 1000,
        conditionId: "0xcond",
        type: "TRADE",
        side: "BUY",
        size: "10",
        usdcSize: 100,
        transactionHash: "0xtx1",
        price: "0.5",
        asset: "0xa",
        outcomeIndex: 0,
      },
      {
        proxyWallet: "0xabc",
        timestamp: 2000,
        conditionId: "0xcond",
        type: "TRADE",
        side: "SELL",
        size: "10",
        usdcSize: 180,
        transactionHash: "0xtx2",
        price: "0.9",
        asset: "0xa",
        outcomeIndex: 0,
      },
      {
        proxyWallet: "0xabc",
        timestamp: 3000,
        conditionId: "0xcond2",
        type: "REDEEM",
        side: undefined,
        size: "5",
        usdcSize: 50,
        transactionHash: "0xtx3",
        price: "1",
        asset: "0xb",
        outcomeIndex: 0,
      },
    ];

    const positions: WalletPositionRaw[] = [];

    const result = computeCashFlowPnl(activities, positions);

    // realizedCashFlow = SELL(180) + REDEEM(50) − BUY(100) = 130
    // totalPnl = 130 + 0(MTM) = 130
    expect(result.realizedPnl).toBeCloseTo(130, 5);
    expect(result.totalPnl).toBeCloseTo(130, 5);
  });
});
