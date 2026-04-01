import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  PolymarketInvalidPayloadError,
  PolymarketHttpClient,
  PolymarketHttpTimeoutError,
  PolymarketUpstreamStatusError
} from "./polymarket-http.client.js";

const { getMarketsMock, clobClientConstructorMock } = vi.hoisted(() => ({
  getMarketsMock: vi.fn<() => Promise<unknown>>(),
  clobClientConstructorMock: vi.fn()
}));

vi.mock("@polymarket/clob-client", () => ({
  ClobClient: class {
    constructor(...args: unknown[]) {
      clobClientConstructorMock(...args);
    }

    getMarkets = getMarketsMock;
  },
  INITIAL_CURSOR: "MA==",
  END_CURSOR: "LTE=",
}));

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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("success 200 returns array", async () => {
    const markets = [{ id: "m1" }, { id: "m2" }];
    getMarketsMock.mockResolvedValue({
      data: markets,
      count: 2,
      limit: 100,
      next_cursor: "LTE="
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_HTTP_TIMEOUT_MS: "1500"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    const result = await client.fetchMarkets();

    expect(result).toEqual(markets);
    expect(getMarketsMock).toHaveBeenCalledTimes(1);
    expect(getMarketsMock).toHaveBeenCalledWith("MA==");
    expect(clobClientConstructorMock).toHaveBeenCalledWith(
      "https://clob.polymarket.com",
      137
    );
  });

  it("timeout error", async () => {
    const neverSettles = new Promise<unknown>(() => {});
    getMarketsMock.mockReturnValue(neverSettles);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_HTTP_TIMEOUT_MS: "1"
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
    getMarketsMock.mockRejectedValue({ status: 502 });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com"
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

  it("uses default clob host when POLYMARKET_REST_URL is missing", async () => {
    getMarketsMock.mockResolvedValue({
      data: [],
      count: 0,
      limit: 100,
      next_cursor: "LTE="
    });
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({})
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    await client.fetchMarkets();

    expect(clobClientConstructorMock).toHaveBeenCalledWith(
      "https://clob.polymarket.com",
      137
    );
  });

  it("invalid timeout uses 10000", async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_HTTP_TIMEOUT_MS: "0"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    const timeoutMs = (client as unknown as { timeoutMs: number }).timeoutMs;
    expect(timeoutMs).toBe(10000);
  });

  it("invalid timeout NaN string uses 10000", async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com",
            POLYMARKET_HTTP_TIMEOUT_MS: "abc"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);
    const timeoutMs = (client as unknown as { timeoutMs: number }).timeoutMs;
    expect(timeoutMs).toBe(10000);
  });

  it("throws PolymarketInvalidPayloadError when array contains invalid element", async () => {
    getMarketsMock.mockResolvedValue({
      data: [null],
      count: 1,
      limit: 100,
      next_cursor: "LTE="
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com"
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
    getMarketsMock.mockResolvedValue({
      invalid: "shape"
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com"
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

  it("классифицирует undici ConnectTimeoutError как PolymarketHttpTimeoutError", async () => {
    const connectTimeoutError = Object.assign(new Error("connect timeout"), {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    getMarketsMock.mockRejectedValue(connectTimeoutError);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PolymarketHttpClient,
        {
          provide: ConfigService,
          useValue: new TestConfigService({
            POLYMARKET_REST_URL: "https://clob.polymarket.com"
          })
        }
      ]
    }).compile();

    const client = moduleRef.get(PolymarketHttpClient);

    await expect(client.fetchMarkets()).rejects.toBeInstanceOf(PolymarketHttpTimeoutError);
  });
});
