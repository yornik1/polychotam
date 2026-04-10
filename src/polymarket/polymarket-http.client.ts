import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClobClient } from "@polymarket/clob-client";
import { PolymarketMarketRaw } from "./dto/polymarket-market.raw.js";
import { PolymarketSimplifiedMarketRaw } from "./dto/polymarket-simplified-market.raw.js";

const DEFAULT_HTTP_TIMEOUT_MS = 10000;
const DEFAULT_POLYMARKET_CLOB_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

const INITIAL_CURSOR = "MA==";

export class PolymarketUpstreamStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    message = `Polymarket upstream returned ${statusCode}`
  ) {
    super(message);
    this.name = "PolymarketUpstreamStatusError";
  }
}

export class PolymarketHttpTimeoutError extends Error {
  constructor(message = "Polymarket request timed out") {
    super(message);
    this.name = "PolymarketHttpTimeoutError";
  }
}

export class PolymarketInvalidPayloadError extends Error {
  constructor(message = "Polymarket markets response payload is invalid") {
    super(message);
    this.name = "PolymarketInvalidPayloadError";
  }
}

@Injectable()
export class PolymarketHttpClient {
  private readonly host: string;
  private readonly timeoutMs: number;
  private readonly client: Pick<ClobClient, "getMarkets">;

  constructor(private readonly configService: ConfigService) {
    this.host = this.resolveHost();
    this.timeoutMs = this.resolveTimeoutMs();
    this.client = new ClobClient(this.host, POLYGON_CHAIN_ID);
  }

  async fetchMarkets(): Promise<PolymarketMarketRaw[]> {
    try {
      const payload = await this.withTimeout(this.client.getMarkets(INITIAL_CURSOR));
      const rawMarkets = this.extractMarkets(payload);
      return this.validateMarkets(rawMarkets);
    } catch (error: unknown) {
      if (this.isTimeoutError(error)) {
        throw new PolymarketHttpTimeoutError();
      }
      const statusCode = this.extractStatusCode(error);
      if (statusCode !== undefined) {
        throw new PolymarketUpstreamStatusError(statusCode);
      }
      throw error;
    }
  }

  async fetchSimplifiedMarkets(): Promise<PolymarketSimplifiedMarketRaw[]> {
    const response = await this.withTimeout(
      fetch(`${this.host}/simplified-markets?next_cursor=${INITIAL_CURSOR}`)
    );

    if (!response.ok) {
      throw new PolymarketUpstreamStatusError(response.status);
    }

    const payload = await response.json();
    const rawMarkets = this.extractMarkets(payload);
    return this.validateSimplifiedMarkets(rawMarkets);
  }

  private resolveHost(): string {
    const host = this.configService.get<string>("POLYMARKET_REST_URL");
    if (typeof host !== "string" || host.trim() === "") {
      return DEFAULT_POLYMARKET_CLOB_URL;
    }
    return host.trim();
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    const timeoutError = new PolymarketHttpTimeoutError();
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(timeoutError), this.timeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private extractMarkets(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (this.isPaginationPayload(payload)) {
      return payload.data;
    }
    throw new PolymarketInvalidPayloadError("Polymarket markets response is not an array");
  }

  private validateMarkets(payload: unknown[]): PolymarketMarketRaw[] {
    const hasInvalidElement = payload.some((item: unknown) => item === null || typeof item !== "object");
    if (hasInvalidElement) {
      throw new PolymarketInvalidPayloadError(
        "Polymarket markets response contains invalid market item"
      );
    }
    return payload as PolymarketMarketRaw[];
  }

  private validateSimplifiedMarkets(payload: unknown[]): PolymarketSimplifiedMarketRaw[] {
    const hasInvalidElement = payload.some((item: unknown) => {
      if (item === null || typeof item !== "object") {
        return true;
      }

      const tokens = (item as { tokens?: unknown }).tokens;
      if (!Array.isArray(tokens)) {
        return true;
      }

      return tokens.some((token: unknown) => token === null || typeof token !== "object");
    });

    if (hasInvalidElement) {
      throw new PolymarketInvalidPayloadError(
        "Polymarket simplified markets response contains invalid market item"
      );
    }

    return payload as PolymarketSimplifiedMarketRaw[];
  }

  private resolveTimeoutMs(): number {
    const timeoutRaw = this.configService.get<string>("POLYMARKET_HTTP_TIMEOUT_MS");
    const timeoutNumber = Number(timeoutRaw);

    if (!Number.isFinite(timeoutNumber) || timeoutNumber <= 0) {
      return DEFAULT_HTTP_TIMEOUT_MS;
    }

    return timeoutNumber;
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    const maybeStatus = (error as { status?: unknown }).status;
    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    const statusCandidate = typeof maybeStatus === "number" ? maybeStatus : maybeStatusCode;

    if (typeof statusCandidate !== "number" || statusCandidate < 400) {
      return undefined;
    }

    return statusCandidate;
  }

  private isPaginationPayload(value: unknown): value is { data: unknown[]; next_cursor: string } {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const maybeData = (value as { data?: unknown }).data;
    return Array.isArray(maybeData);
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    if (error instanceof PolymarketHttpTimeoutError) {
      return true;
    }

    const code = (error as { code?: unknown }).code;

    // undici ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT) и стандартные AbortSignal-ошибки
    return (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.name === "ConnectTimeoutError" ||
      code === "UND_ERR_CONNECT_TIMEOUT"
    );
  }
}
