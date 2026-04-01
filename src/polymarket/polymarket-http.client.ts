import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PolymarketMarketRaw } from "./dto/polymarket-market.raw.js";

const DEFAULT_HTTP_TIMEOUT_MS = 10000;

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
  private readonly restUrl: string;
  private readonly marketsPath: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.restUrl = this.configService.getOrThrow<string>("POLYMARKET_REST_URL");
    this.marketsPath = this.configService.getOrThrow<string>("POLYMARKET_MARKETS_PATH");
    this.timeoutMs = this.resolveTimeoutMs();
  }

  async fetchMarkets(): Promise<PolymarketMarketRaw[]> {
    const endpointUrl = new URL(this.marketsPath, this.restUrl).toString();

    let response: Response;
    try {
      response = await fetch(endpointUrl, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error: unknown) {
      if (this.isTimeoutError(error)) {
        throw new PolymarketHttpTimeoutError();
      }
      throw error;
    }

    if (response.status >= 400) {
      throw new PolymarketUpstreamStatusError(response.status);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new PolymarketInvalidPayloadError("Polymarket markets response is not an array");
    }

    const hasInvalidElement = payload.some(
      (item: unknown) => item === null || typeof item !== "object"
    );
    if (hasInvalidElement) {
      throw new PolymarketInvalidPayloadError(
        "Polymarket markets response contains invalid market item"
      );
    }

    return payload as PolymarketMarketRaw[];
  }

  private resolveTimeoutMs(): number {
    const timeoutRaw = this.configService.get<string>("POLYMARKET_HTTP_TIMEOUT_MS");
    const timeoutNumber = Number(timeoutRaw);

    if (!Number.isFinite(timeoutNumber) || timeoutNumber <= 0) {
      return DEFAULT_HTTP_TIMEOUT_MS;
    }

    return timeoutNumber;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === "TimeoutError" || error.name === "AbortError";
  }
}
