import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import {
  DataApiClient,
  DataApiMaxPagesExceededError,
  DataApiTimeoutError,
  DataApiUpstreamError,
} from "./data-api.client.js";
import type { WalletActivityRaw, WalletPositionRaw } from "../types/contracts.js";

// ─── Фабрики тестовых данных ─────────────────────────────────────────────────

function makeActivity(overrides: Partial<WalletActivityRaw> = {}): WalletActivityRaw {
  return {
    proxyWallet: "0xabc",
    timestamp: 1700000000,
    conditionId: "0xcondition",
    type: "TRADE",
    size: 10,
    usdcSize: 5,
    transactionHash: "0xtx",
    side: "BUY",
    ...overrides,
  };
}

function makePosition(overrides: Partial<WalletPositionRaw> = {}): WalletPositionRaw {
  return {
    proxyWallet: "0xabc",
    asset: "0xasset",
    conditionId: "0xcondition",
    size: 100,
    avgPrice: 0.5,
    curPrice: 0.6,
    currentValue: 60,
    ...overrides,
  };
}

// ─── Хелпер извлечения URL из мока fetch ─────────────────────────────────────

function capturedUrl(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const call = fetchMock.mock.calls[callIndex];
  if (!call) throw new Error(`fetch не был вызван (индекс ${callIndex})`);
  return call[0] as string;
}

// ─── Хелпер ConfigService ────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    POLYMARKET_DATA_API_URL: "https://data-api.test",
    POLYMARKET_LB_API_URL: "https://lb-api.test",
    POLYMARKET_HTTP_TIMEOUT_MS: "5000",
    POLYMARKET_BACKFILL_PAGE_DELAY_MS: "0",
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => values[key]),
    getOrThrow: vi.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`Missing: ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

// ─── Хелпер мок-ответа fetch ─────────────────────────────────────────────────

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(""),
  });
}

function mockFetchStatus(status: number, body = "") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  });
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("DataApiClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── fetchActivityPage ────────────────────────────────────────────────────

  describe("fetchActivityPage", () => {
    it("передаёт user, limit, offset в URL", async () => {
      const fetch = mockFetchOk([makeActivity()]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchActivityPage("0xabc", { offset: 0 });

      expect(fetch).toHaveBeenCalledOnce();
      const url = capturedUrl(fetch);
      expect(url).toContain("user=0xabc");
      expect(url).toContain("limit=500");
      expect(url).toContain("offset=0");
    });

    it("передаёт start и end в URL (инклюзивно)", async () => {
      const fetch = mockFetchOk([]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchActivityPage("0xabc", { offset: 0, start: 1700000000, end: 1700009999 });

      const url = capturedUrl(fetch);
      expect(url).toContain("start=1700000000");
      expect(url).toContain("end=1700009999");
    });

    it("передаёт sortDirection в URL", async () => {
      const fetch = mockFetchOk([]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchActivityPage("0xabc", { offset: 0, sortDirection: "ASC" });

      const url = capturedUrl(fetch);
      expect(url).toContain("sortDirection=ASC");
    });

    it("передаёт type в URL", async () => {
      const fetch = mockFetchOk([]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchActivityPage("0xabc", { offset: 0, type: "TRADE" });

      const url = capturedUrl(fetch);
      expect(url).toContain("type=TRADE");
    });

    it("возвращает распарсенный массив записей", async () => {
      const rows = [makeActivity({ type: "REDEEM" }), makeActivity({ type: "MAKER_REBATE" })];
      vi.stubGlobal("fetch", mockFetchOk(rows));

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchActivityPage("0xabc", { offset: 0 });

      expect(result).toHaveLength(2);
      expect(result[0]?.type).toBe("REDEEM");
    });

    it("при 4xx — бросает DataApiUpstreamError", async () => {
      vi.stubGlobal("fetch", mockFetchStatus(404, "not found"));

      const client = new DataApiClient(makeConfig());
      await expect(client.fetchActivityPage("0xabc", { offset: 0 })).rejects.toThrow(
        DataApiUpstreamError,
      );
    });

    it("при 5xx — бросает DataApiUpstreamError с кодом", async () => {
      vi.stubGlobal("fetch", mockFetchStatus(500, "server error"));

      const client = new DataApiClient(makeConfig());
      const err = await client.fetchActivityPage("0xabc", { offset: 0 }).catch((e) => e);
      expect(err).toBeInstanceOf(DataApiUpstreamError);
      expect((err as DataApiUpstreamError).statusCode).toBe(500);
    });

    it("при таймауте — бросает DataApiTimeoutError", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          () => new Promise<never>(() => undefined), // зависает навсегда
        ),
      );

      const client = new DataApiClient(makeConfig({ POLYMARKET_HTTP_TIMEOUT_MS: "10" }));
      await expect(client.fetchActivityPage("0xabc", { offset: 0 })).rejects.toThrow(
        DataApiTimeoutError,
      );
    });
  });

  // ─── fetchAllActivity ─────────────────────────────────────────────────────

  describe("fetchAllActivity", () => {
    it("возвращает все записи при одной полной и одной пустой странице", async () => {
      const fullPage = Array.from({ length: 500 }, (_, i) => makeActivity({ timestamp: i }));
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(fullPage), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]), text: vi.fn().mockResolvedValue("") });
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchAllActivity("0xabc");

      expect(result).toHaveLength(500);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("терминирует по неполной последней странице", async () => {
      const fullPage = Array.from({ length: 500 }, (_, i) => makeActivity({ timestamp: i }));
      const partialPage = Array.from({ length: 3 }, (_, i) => makeActivity({ timestamp: 1000 + i }));
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(fullPage), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(partialPage), text: vi.fn().mockResolvedValue("") });
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchAllActivity("0xabc");

      expect(result).toHaveLength(503);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("терминирует немедленно при пустой первой странице", async () => {
      const fetch = mockFetchOk([]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchAllActivity("0xabc");

      expect(result).toHaveLength(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("передаёт offset 0, 500, 1000 в последовательные запросы", async () => {
      const fullPage = Array.from({ length: 500 }, () => makeActivity());
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(fullPage), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(fullPage), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]), text: vi.fn().mockResolvedValue("") });
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchAllActivity("0xabc");

      const urls = fetch.mock.calls.map((_, i) => capturedUrl(fetch, i));
      expect(urls[0]).toContain("offset=0");
      expect(urls[1]).toContain("offset=500");
      expect(urls[2]).toContain("offset=1000");
    });

    it("при превышении maxPages — бросает DataApiMaxPagesExceededError", async () => {
      const fullPage = Array.from({ length: 500 }, () => makeActivity());
      // все страницы полные — пагинация никогда не завершится сама
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(fullPage),
        text: vi.fn().mockResolvedValue(""),
      }));

      const client = new DataApiClient(makeConfig());
      await expect(
        client.fetchAllActivity("0xabc", { maxPages: 2 }),
      ).rejects.toThrow(DataApiMaxPagesExceededError);
    });

    it("передаёт start в каждый запрос страницы", async () => {
      const fullPage = Array.from({ length: 500 }, () => makeActivity());
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(fullPage), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue([]), text: vi.fn().mockResolvedValue("") });
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchAllActivity("0xabc", { start: 1700000000, sortDirection: "ASC" });

      const urls = fetch.mock.calls.map((_, i) => capturedUrl(fetch, i));
      expect(urls[0]).toContain("start=1700000000");
      expect(urls[0]).toContain("sortDirection=ASC");
      expect(urls[1]).toContain("start=1700000000");
    });
  });

  // ─── fetchPositions ───────────────────────────────────────────────────────

  describe("fetchPositions", () => {
    it("передаёт sizeThreshold=0 в URL", async () => {
      const fetch = mockFetchOk([makePosition()]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchPositions("0xabc");

      const url = capturedUrl(fetch);
      expect(url).toContain("sizeThreshold=0");
    });

    it("пагинирует позиции через offset", async () => {
      const fullPage = Array.from({ length: 500 }, () => makePosition());
      const partialPage = [makePosition()];
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(fullPage), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(partialPage), text: vi.fn().mockResolvedValue("") });
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchPositions("0xabc");

      expect(result).toHaveLength(501);
      const urls = fetch.mock.calls.map((_, i) => capturedUrl(fetch, i));
      expect(urls[0]).toContain("offset=0");
      expect(urls[1]).toContain("offset=500");
    });

    it("при 4xx — бросает DataApiUpstreamError", async () => {
      vi.stubGlobal("fetch", mockFetchStatus(403));

      const client = new DataApiClient(makeConfig());
      await expect(client.fetchPositions("0xabc")).rejects.toThrow(DataApiUpstreamError);
    });
  });

  // ─── fetchLbProfit ────────────────────────────────────────────────────────

  describe("fetchLbProfit", () => {
    it("возвращает первый элемент при непустом ответе", async () => {
      const entry = { proxyWallet: "0xabc", amount: -7.66 };
      vi.stubGlobal("fetch", mockFetchOk([entry]));

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchLbProfit("0xabc", "all");

      expect(result).toEqual(entry);
    });

    it("возвращает null при пустом массиве", async () => {
      vi.stubGlobal("fetch", mockFetchOk([]));

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchLbProfit("0xabc", "30d");

      expect(result).toBeNull();
    });

    it("передаёт window, limit=1 и address в URL", async () => {
      const fetch = mockFetchOk([{ proxyWallet: "0xabc", amount: 0 }]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchLbProfit("0xabc", "7d");

      const url = capturedUrl(fetch);
      expect(url).toContain("window=7d");
      expect(url).toContain("limit=1");
      expect(url).toContain("address=0xabc");
      expect(url).toContain("lb-api.test/profit");
    });

    it("использует дефолтный lb-api URL если env не задан", async () => {
      const fetch = mockFetchOk([]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig({ POLYMARKET_LB_API_URL: "" }));
      await client.fetchLbProfit("0xabc", "1d");

      const url = capturedUrl(fetch);
      expect(url).toContain("https://lb-api.polymarket.com/profit");
    });

    it("при 5xx — бросает DataApiUpstreamError", async () => {
      vi.stubGlobal("fetch", mockFetchStatus(500));

      const client = new DataApiClient(makeConfig());
      await expect(client.fetchLbProfit("0xabc", "all")).rejects.toThrow(DataApiUpstreamError);
    });

    it("при таймауте — бросает DataApiTimeoutError", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => new Promise<never>(() => undefined)),
      );

      const client = new DataApiClient(makeConfig({ POLYMARKET_HTTP_TIMEOUT_MS: "10" }));
      await expect(client.fetchLbProfit("0xabc", "all")).rejects.toThrow(DataApiTimeoutError);
    });
  });

  describe("fetchHolders", () => {
    it("строит URL с market и limit, парсит массив групп холдеров", async () => {
      const body = [
        {
          token: "tokenYes",
          holders: [
            { proxyWallet: "0xaaa", asset: "tokenYes", amount: 354.89, outcomeIndex: 1 },
            { proxyWallet: "0xbbb", asset: "tokenYes", amount: 199.95, outcomeIndex: 1 },
          ],
        },
      ];
      const fetch = mockFetchOk(body);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchHolders("0xcond", 50);

      const url = capturedUrl(fetch);
      expect(url).toContain("https://data-api.test/holders");
      expect(url).toContain("market=0xcond");
      expect(url).toContain("limit=50");
      expect(result).toHaveLength(1);
      expect(result[0]?.holders[0]?.proxyWallet).toBe("0xaaa");
    });

    it("при non-array payload — бросает ошибку формата", async () => {
      vi.stubGlobal("fetch", mockFetchOk({ unexpected: true }));

      const client = new DataApiClient(makeConfig());
      await expect(client.fetchHolders("0xcond")).rejects.toThrow(/unexpected payload shape/);
    });

    it("при 5xx — бросает DataApiUpstreamError", async () => {
      vi.stubGlobal("fetch", mockFetchStatus(503));

      const client = new DataApiClient(makeConfig());
      await expect(client.fetchHolders("0xcond")).rejects.toThrow(DataApiUpstreamError);
    });
  });

  describe("fetchClosedPositions", () => {
    it("строит URL с user и пагинируется по offset до неполной страницы", async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => ({
        proxyWallet: "0xabc",
        asset: `a${i}`,
        conditionId: `c${i}`,
        avgPrice: 0.4,
        totalBought: 10,
        realizedPnl: 1,
      }));
      const page2 = [
        { proxyWallet: "0xabc", asset: "last", conditionId: "cl", avgPrice: 0.6, totalBought: 5, realizedPnl: -2 },
      ];
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(page1), text: vi.fn().mockResolvedValue("") })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue(page2), text: vi.fn().mockResolvedValue("") });
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchClosedPositions("0xabc");

      expect(result).toHaveLength(501);
      expect(capturedUrl(fetch, 0)).toContain("https://data-api.test/closed-positions");
      expect(capturedUrl(fetch, 0)).toContain("user=0xabc");
      expect(capturedUrl(fetch, 1)).toContain("offset=500");
    });

    it("при non-array payload — бросает ошибку формата", async () => {
      vi.stubGlobal("fetch", mockFetchOk({ unexpected: true }));
      const client = new DataApiClient(makeConfig());
      await expect(client.fetchClosedPositions("0xabc")).rejects.toThrow(/unexpected payload shape/);
    });
  });

  describe("fetchRecentTrades", () => {
    it("по умолчанию без market, с limit/offset; парсит массив", async () => {
      const body = [
        { proxyWallet: "0x111", conditionId: "0xc", side: "BUY", size: 5, price: 0.6, timestamp: 1700 },
      ];
      const fetch = mockFetchOk(body);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      const result = await client.fetchRecentTrades({ limit: 25 });

      const url = capturedUrl(fetch);
      expect(url).toContain("https://data-api.test/trades");
      expect(url).toContain("limit=25");
      expect(url).not.toContain("market=");
      expect(result[0]?.proxyWallet).toBe("0x111");
    });

    it("с market — добавляет фильтр market", async () => {
      const fetch = mockFetchOk([]);
      vi.stubGlobal("fetch", fetch);

      const client = new DataApiClient(makeConfig());
      await client.fetchRecentTrades({ market: "0xcond", limit: 10 });

      expect(capturedUrl(fetch)).toContain("market=0xcond");
    });

    it("при non-array payload — бросает ошибку формата", async () => {
      vi.stubGlobal("fetch", mockFetchOk({ nope: 1 }));
      const client = new DataApiClient(makeConfig());
      await expect(client.fetchRecentTrades()).rejects.toThrow(/unexpected payload shape/);
    });
  });
});
