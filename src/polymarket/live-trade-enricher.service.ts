import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { TradeEnrichmentJob } from "../types/contracts.js";

const DEFAULT_POLYMARKET_DATA_API_URL = "https://data-api.polymarket.com";
const ENRICHMENT_FETCH_LIMIT = 200;

interface HistoricalTradeCandidate {
  readonly market?: unknown;
  readonly conditionId?: unknown;
  readonly asset_id?: unknown;
  readonly asset?: unknown;
  readonly side?: unknown;
  readonly size?: unknown;
  readonly price?: unknown;
  readonly match_time?: unknown;
  readonly timestamp?: unknown;
  readonly maker_address?: unknown;
  readonly proxyWallet?: unknown;
  readonly owner?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeToSeconds(timestamp: number): number {
  return timestamp > 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

@Injectable()
export class LiveTradeEnricherService {
  constructor(private readonly configService: ConfigService) {}

  async findMakerAddress(job: TradeEnrichmentJob): Promise<string | null> {
    const response = await fetch(this.buildTradesUrl(job.market));
    if (!response.ok) {
      throw new Error(
        `Trade enrichment request failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as unknown;
    const trades = this.extractTrades(payload);

    for (const trade of trades) {
      if (this.matchesJob(job, trade)) {
        return (
          asString(trade.maker_address) ??
          asString(trade.proxyWallet) ??
          asString(trade.owner)
        );
      }
    }

    return null;
  }

  private buildTradesUrl(market: string): string {
    const rawBaseUrl = this.configService.get<string>("POLYMARKET_DATA_API_URL");
    const baseUrl =
      typeof rawBaseUrl === "string" && rawBaseUrl.trim().length > 0
        ? rawBaseUrl.trim()
        : DEFAULT_POLYMARKET_DATA_API_URL;

    return `${baseUrl}/trades?market=${encodeURIComponent(market)}&limit=${ENRICHMENT_FETCH_LIMIT}`;
  }

  private extractTrades(payload: unknown): HistoricalTradeCandidate[] {
    if (Array.isArray(payload)) {
      return payload.filter(isPlainRecord) as HistoricalTradeCandidate[];
    }

    if (isPlainRecord(payload) && Array.isArray(payload["data"])) {
      return payload["data"].filter(isPlainRecord) as HistoricalTradeCandidate[];
    }

    throw new Error("Trade enrichment payload is invalid");
  }

  private matchesJob(job: TradeEnrichmentJob, trade: HistoricalTradeCandidate): boolean {
    const market = asString(trade.market) ?? asString(trade.conditionId);
    const assetId = asString(trade.asset_id) ?? asString(trade.asset);
    const side = asString(trade.side);
    const size = asString(trade.size);
    const price = asString(trade.price);
    const timestamp = asTimestamp(trade.match_time) ?? asTimestamp(trade.timestamp);

    if (
      market === null ||
      assetId === null ||
      side === null ||
      size === null ||
      price === null ||
      timestamp === null
    ) {
      return false;
    }

    return (
      market === job.market &&
      assetId === job.assetId &&
      side === job.side &&
      size === job.amount &&
      price === job.price &&
      normalizeToSeconds(timestamp) === normalizeToSeconds(job.timestamp)
    );
  }
}
