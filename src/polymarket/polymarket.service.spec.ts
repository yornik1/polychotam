import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolymarketHttpClient } from "./polymarket-http.client.js";
import type { BackfillService } from "./backfill.service.js";
import type { PolymarketWsClient } from "./polymarket-ws.client.js";
import { PolymarketService } from "./polymarket.service.js";

type PolymarketServiceCtor = new (
  polymarketHttpClient: PolymarketHttpClient,
  marketsSyncService: { syncSnapshot(): Promise<void> },
  backfillService: BackfillService,
  polymarketWsClient: PolymarketWsClient,
) => {
  onModuleInit(): Promise<void>;
};

describe("PolymarketService", () => {
  beforeEach(() => {
    vi.spyOn(global, "setTimeout").mockImplementation(
      (handler: TimerHandler) => {
        if (typeof handler === "function") {
          (handler as () => void)();
        }
        return 0 as unknown as NodeJS.Timeout;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("на старте синхронизирует markets snapshot до backfill", async () => {
    const fetchMarkets = vi.fn().mockResolvedValue([
      {
        condition_id:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        market_slug: "market-1",
        question: "market 1",
        tokens: [{ token_id: "token-1a" }, { token_id: "token-1b" }],
        active: true,
        closed: false,
        accepting_orders: true,
        volume24hr: 200,
      },
    ]);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);
    const deepBackfill = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      { fetchMarkets } as unknown as PolymarketHttpClient,
      { syncSnapshot } as { syncSnapshot(): Promise<void> },
      { deepBackfill } as unknown as BackfillService,
      { connect } as unknown as PolymarketWsClient,
    );

    await service.onModuleInit();

    expect(syncSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot.mock.invocationCallOrder[0]!).toBeLessThan(
      deepBackfill.mock.invocationCallOrder[0]!,
    );
  });

  it("на старте запускает deep backfill топовых маркетов до подключения WS", async () => {
    const fetchMarkets = vi.fn().mockResolvedValue([
      {
        condition_id:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        market_slug: "market-1",
        question: "market 1",
        tokens: [{ token_id: "token-1a" }, { token_id: "token-1b" }],
        active: true,
        closed: false,
        accepting_orders: true,
        volume24hr: 200,
      },
      {
        condition_id:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        market_slug: "market-2",
        question: "market 2",
        tokens: [{ token_id: "token-2a" }, { token_id: "token-2b" }],
        active: true,
        closed: false,
        accepting_orders: true,
        volume24hr: 100,
      },
    ]);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);
    const deepBackfill = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      { fetchMarkets } as unknown as PolymarketHttpClient,
      { syncSnapshot } as { syncSnapshot(): Promise<void> },
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
    expect(fetchMarkets.mock.invocationCallOrder[0]!).toBeLessThan(
      deepBackfill.mock.invocationCallOrder[0]!,
    );
    expect(deepBackfill.mock.invocationCallOrder[1]!).toBeLessThan(
      connect.mock.invocationCallOrder[0]!,
    );
  });

  it("не блокирует live WS если deep backfill одного рынка упал", async () => {
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
      {
        condition_id:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        market_slug: "market-2",
        question: "market 2",
        tokens: [{ token_id: "token-2a" }],
        active: true,
        closed: false,
        accepting_orders: true,
        volume24hr: 100,
      },
    ]);
    const deepBackfill = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    const syncSnapshot = vi.fn().mockResolvedValue(undefined);

    const ServiceCtor = PolymarketService as unknown as PolymarketServiceCtor;
    const service = new ServiceCtor(
      { fetchMarkets } as unknown as PolymarketHttpClient,
      { syncSnapshot } as { syncSnapshot(): Promise<void> },
      { deepBackfill } as unknown as BackfillService,
      { connect } as unknown as PolymarketWsClient,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(deepBackfill).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledWith(["token-1a", "token-2a"]);
  });
});
