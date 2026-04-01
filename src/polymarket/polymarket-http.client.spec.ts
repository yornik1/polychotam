import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  PolymarketInvalidPayloadError,
  PolymarketHttpClient,
  PolymarketHttpTimeoutError,
  PolymarketUpstreamStatusError
} from "./polymarket-http.client.js";

type EnvMap = Record<string, string | undefined>;

class TestConfigService {
  constructor(private readonly values: EnvMap) {}

  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }

  getOrThrow<T>(key: string): T {
    const value = this.values[key];
    if (value === undefined || value === "") {
      throw new Error(`Missing required config value: ${key}`);
    }
    return value as T;
  }
}

describe("PolymarketHttpClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("success 200 returns array", async () => {
    const markets = [{ id: "m1" }, { id: "m2" }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(markets), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    const result = await client.fetchMarkets();

    expect(result).toEqual(markets);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("timeout error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("Timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets",
            POLYMARKET_HTTP_TIMEOUT_MS: "1234"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);

    await expect(client.fetchMarkets()).rejects.toBeInstanceOf(
      PolymarketHttpTimeoutError
    );
    await expect(client.fetchMarkets()).rejects.toThrowError("Polymarket request timed out");
  });

  it("typed upstream status error", async () => {
    const fetchMock = vi.fn(async () => new Response("Bad Gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);

    const error = await client.fetchMarkets().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PolymarketUpstreamStatusError);
    expect(error).toMatchObject({
      statusCode: 502
    });
  });

  it("throws on missing required env", async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          PolymarketHttpClient,
          {
            provide: ConfigService,
            useValue: new TestConfigService({
              POLYMARKET_REST_URL: "https://clob.polymarket.com"
            })
          }
        ]
      }).compile()
    ).rejects.toThrowError(
      "Missing required config value: POLYMARKET_MARKETS_PATH"
    );
  });

  it("throws on missing POLYMARKET_REST_URL", async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          PolymarketHttpClient,
          {
            provide: ConfigService,
            useValue: new TestConfigService({
              POLYMARKET_MARKETS_PATH: "/markets"
            })
          }
        ]
      }).compile()
    ).rejects.toThrowError("Missing required config value: POLYMARKET_REST_URL");
  });

  it("invalid timeout uses 10000", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);

    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      return new Response(JSON.stringify([]), { status: 200, statusText: String(init?.signal) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets",
            POLYMARKET_HTTP_TIMEOUT_MS: "0"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    await client.fetchMarkets();

    expect(timeoutSpy).toHaveBeenCalledWith(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined];
    expect(callArgs[1]?.signal).toBe(timeoutSignal);
  });

  it("invalid timeout NaN string uses 10000", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);

    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      return new Response(JSON.stringify([]), { status: 200, statusText: String(init?.signal) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets",
            POLYMARKET_HTTP_TIMEOUT_MS: "abc"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    await client.fetchMarkets();

    expect(timeoutSpy).toHaveBeenCalledWith(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws PolymarketInvalidPayloadError when array contains invalid element", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([null]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);

    await expect(client.fetchMarkets()).rejects.toBeInstanceOf(PolymarketInvalidPayloadError);
    await expect(client.fetchMarkets()).rejects.toThrowError(
      "Polymarket markets response contains invalid market item"
    );
  });

  it("throws PolymarketInvalidPayloadError when payload is not array", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "not-array" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_MARKETS_PATH: "/markets"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);

    await expect(client.fetchMarkets()).rejects.toBeInstanceOf(PolymarketInvalidPayloadError);
    await expect(client.fetchMarkets()).rejects.toThrowError(
      "Polymarket markets response is not an array"
    );
  });
});
