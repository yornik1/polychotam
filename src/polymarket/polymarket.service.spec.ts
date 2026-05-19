import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { PolymarketHttpClient } from "./polymarket-http.client.js";
import type { BackfillService } from "./backfill.service.js";
import type { PolymarketWsClient } from "./polymarket-ws.client.js";
import { PolymarketService } from "./polymarket.service.js";

type PolymarketServiceCtor = new (
  configService: Pick<ConfigService, "get">,
  polymarketHttpClient: PolymarketHttpClient,
  marketsSyncService: {
    syncSnapshot(): Promise<void>;
    upsertGammaMarketsAndCollectNewlyResolved(
      markets: readonly Record<string, unknown>[],
    ): Promise<readonly string[]>;
  },
  backfillService: BackfillService,
  polymarketWsClient: PolymarketWsClient,
) => {
  onModuleInit(): Promise<void>;
};

const gammaMarket = (overrides: Record<string, unknown> = {}) => ({
  conditionId:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  slug: "market-1",
  question: "market 1",
  clobTokenIds: ["token-1a", "token-1b"],
  active: true,
  closed: false,
  volume24hr: 200,
  ...overrides,
});

describe("PolymarketService", () => {
  const configService = {
    get: vi.fn().mockReturnValue(undefined),
  } as Pick<ConfigService, "get"> as ConfigService;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("на старте синхронизирует markets snapshot до подключения WS", async () => {
    const fetchActiveMarketsFromGamma = vi.fn().mockResolvedValue([gammaMarket()]);
    const fetchMarkets = vi.fn();
    const upsertGammaMarketsAndCollectNewlyResolved = vi
      .fn()
      .mockResolvedValue([]);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);
    const deepBackfill = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      configService,
      { fetchActiveMarketsFromGamma, fetchMarkets } as unknown as PolymarketHttpClient,
      {
        syncSnapshot,
        upsertGammaMarketsAndCollectNewlyResolved,
      },
      { deepBackfill } as unknown as BackfillService,
      { connect } as unknown as PolymarketWsClient,
    );

    await service.onModuleInit();

    expect(syncSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot.mock.invocationCallOrder[0]!).toBeLessThan(
      connect.mock.invocationCallOrder[0]!,
    );
  });

  it("на старте подключает WS раньше deep backfill", async () => {
    const fetchActiveMarketsFromGamma = vi.fn().mockResolvedValue([
      gammaMarket(),
      gammaMarket({
        conditionId:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        slug: "market-2",
        question: "market 2",
        clobTokenIds: ["token-2a", "token-2b"],
        volume24hr: 100,
      }),
    ]);
    const fetchMarkets = vi.fn();
    const upsertGammaMarketsAndCollectNewlyResolved = vi
      .fn()
      .mockResolvedValue([]);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);
    const deepBackfill = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      configService,
      { fetchActiveMarketsFromGamma, fetchMarkets } as unknown as PolymarketHttpClient,
      {
        syncSnapshot,
        upsertGammaMarketsAndCollectNewlyResolved,
      },
      { deepBackfill } as unknown as BackfillService,
      { connect } as unknown as PolymarketWsClient,
    );

    await service.onModuleInit();

    expect(deepBackfill).toHaveBeenNthCalledWith(
      1,
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
    expect(deepBackfill).toHaveBeenNthCalledWith(
      2,
      "0x0000000000000000000000000000000000000000000000000000000000000002",
    );
    expect(connect).toHaveBeenCalledWith([
      "token-1a",
      "token-1b",
      "token-2a",
      "token-2b",
    ]);
    expect(connect.mock.invocationCallOrder[0]!).toBeLessThan(
      deepBackfill.mock.invocationCallOrder[0]!,
    );
    expect(fetchActiveMarketsFromGamma.mock.invocationCallOrder[0]!).toBeLessThan(
      connect.mock.invocationCallOrder[0]!,
    );
  });

  it("не блокирует live WS если deep backfill одного рынка упал", async () => {
    const fetchActiveMarketsFromGamma = vi.fn().mockResolvedValue([
      gammaMarket(),
      gammaMarket({
        conditionId:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        slug: "market-2",
        question: "market 2",
        clobTokenIds: ["token-2a"],
        volume24hr: 100,
      }),
    ]);
    const fetchMarkets = vi.fn();
    const upsertGammaMarketsAndCollectNewlyResolved = vi
      .fn()
      .mockResolvedValue([]);
    const deepBackfill = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      configService,
      { fetchActiveMarketsFromGamma, fetchMarkets } as unknown as PolymarketHttpClient,
      {
        syncSnapshot,
        upsertGammaMarketsAndCollectNewlyResolved,
      },
      { deepBackfill } as unknown as BackfillService,
      { connect } as unknown as PolymarketWsClient,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(deepBackfill).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledWith(["token-1a", "token-1b", "token-2a"]);
  });

  it("при ошибке Gamma использует CLOB fetchMarkets", async () => {
    const fetchActiveMarketsFromGamma = vi
      .fn()
      .mockRejectedValue(new Error("gamma down"));
    const fetchMarkets = vi.fn().mockResolvedValue([
      {
        condition_id:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        market_slug: "market-1",
        question: "market 1",
        tokens: [{ token_id: "token-1a" }],
        active: true,
        closed: false,
        accepting_orders: true,
        volume24hr: 200,
      },
    ]);
    const upsertGammaMarketsAndCollectNewlyResolved = vi
      .fn()
      .mockResolvedValue([]);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);
    const deepBackfill = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      configService,
      { fetchActiveMarketsFromGamma, fetchMarkets } as unknown as PolymarketHttpClient,
      {
        syncSnapshot,
        upsertGammaMarketsAndCollectNewlyResolved,
      },
      { deepBackfill } as unknown as BackfillService,
      { connect } as unknown as PolymarketWsClient,
    );

    await service.onModuleInit();

    expect(fetchMarkets).toHaveBeenCalledTimes(1);
    expect(upsertGammaMarketsAndCollectNewlyResolved).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(["token-1a"]);
  });
});
