import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  ClosedPositionRaw,
  DataApiTradeRaw,
  LbProfitResult,
  LbProfitWindow,
  MarketHoldersRaw,
  WalletActivityRaw,
  WalletPositionRaw,
} from "../types/contracts.js";

const DEFAULT_POLYMARKET_DATA_API_URL = "https://data-api.polymarket.com";
const DEFAULT_POLYMARKET_LB_API_URL = "https://lb-api.polymarket.com";
const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_HOLDERS_LIMIT = 100;
/** Потолок страниц closed-positions (40*500 = 20k) — защита от бесконечной пагинации. */
const CLOSED_POSITIONS_MAX_PAGES = 40;
const DEFAULT_HTTP_TIMEOUT_MS = 10000;

/** Ошибка HTTP non-2xx от data-api или lb-api. */
export class DataApiUpstreamError extends Error {
  constructor(
    public readonly statusCode: number,
    body: string,
    url: string,
  ) {
    super(`Data API upstream error ${statusCode} at ${url}: ${body}`);
    this.name = "DataApiUpstreamError";
  }
}

/** Таймаут запроса к data-api / lb-api. */
export class DataApiTimeoutError extends Error {
  constructor(url: string) {
    super(`Data API request timed out: ${url}`);
    this.name = "DataApiTimeoutError";
  }
}

/** Превышен лимит страниц при пагинации. */
export class DataApiMaxPagesExceededError extends Error {
  constructor(address: string, maxPages: number) {
    super(`fetchAllActivity exceeded maxPages=${maxPages} for address=${address}`);
    this.name = "DataApiMaxPagesExceededError";
  }
}

export interface FetchActivityPageOpts {
  offset: number;
  limit?: number;
  start?: number;
  end?: number;
  type?: string;
  sortDirection?: "ASC" | "DESC";
}

export interface FetchAllActivityOpts {
  start?: number;
  sortDirection?: "ASC";
  pageDelayMs?: number;
  maxPages?: number;
}

@Injectable()
export class DataApiClient {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Одна страница активности кошелька из data-api /activity.
   */
  async fetchActivityPage(address: string, opts: FetchActivityPageOpts): Promise<WalletActivityRaw[]> {
    const base = this.resolveDataApiUrl();
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const params = new URLSearchParams({
      user: address,
      limit: String(limit),
      offset: String(opts.offset),
    });
    if (opts.start !== undefined) {
      params.set("start", String(opts.start));
    }
    if (opts.end !== undefined) {
      params.set("end", String(opts.end));
    }
    if (opts.type !== undefined && opts.type.length > 0) {
      params.set("type", opts.type);
    }
    if (opts.sortDirection !== undefined) {
      params.set("sortDirection", opts.sortDirection);
    }

    const url = `${base}/activity?${params}`;
    const payload = await this.fetchJson(url);

    if (!Array.isArray(payload)) {
      throw new Error(`data-api /activity unexpected payload shape at ${url}`);
    }
    return payload as WalletActivityRaw[];
  }

  /**
   * Полная история активности кошелька (цикл по offset).
   * Терминирование — пустая или неполная страница.
   * maxPages → throw DataApiMaxPagesExceededError при превышении.
   */
  async fetchAllActivity(address: string, opts: FetchAllActivityOpts = {}): Promise<WalletActivityRaw[]> {
    const limit = DEFAULT_PAGE_LIMIT;
    const pageDelayMs = opts.pageDelayMs ?? this.resolvePageDelayMs();
    const maxPages = opts.maxPages;

    const result: WalletActivityRaw[] = [];
    let offset = 0;
    let page = 0;

    while (true) {
      if (maxPages !== undefined && page >= maxPages) {
        throw new DataApiMaxPagesExceededError(address, maxPages);
      }

      if (page > 0 && pageDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, pageDelayMs));
      }

      const rows = await this.fetchActivityPage(address, {
        offset,
        limit,
        start: opts.start,
        sortDirection: opts.sortDirection,
      });

      result.push(...rows);

      // пустая или неполная страница — конец данных
      if (rows.length < limit) {
        break;
      }

      offset += limit;
      page += 1;
    }

    return result;
  }

  /**
   * Все позиции кошелька из data-api /positions (sizeThreshold=0 всегда).
   */
  async fetchPositions(address: string): Promise<WalletPositionRaw[]> {
    const base = this.resolveDataApiUrl();
    const limit = DEFAULT_PAGE_LIMIT;
    const result: WalletPositionRaw[] = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        user: address,
        limit: String(limit),
        offset: String(offset),
        sizeThreshold: "0",
      });

      const url = `${base}/positions?${params}`;
      const payload = await this.fetchJson(url);

      if (!Array.isArray(payload)) {
        throw new Error(`data-api /positions unexpected payload shape at ${url}`);
      }

      const rows = payload as WalletPositionRaw[];
      result.push(...rows);

      if (rows.length < limit) {
        break;
      }

      offset += limit;
    }

    return result;
  }

  /**
   * Топ-холдеры рынка из data-api /holders (по conditionId).
   * Возвращает группы холдеров по каждому токену (Yes/No) рынка.
   * Используется краулером кандидатов: адреса крупных холдеров — сид для скоринга.
   */
  async fetchHolders(conditionId: string, limit = DEFAULT_HOLDERS_LIMIT): Promise<MarketHoldersRaw[]> {
    const base = this.resolveDataApiUrl();
    const params = new URLSearchParams({
      market: conditionId,
      limit: String(limit),
    });

    const url = `${base}/holders?${params}`;
    const payload = await this.fetchJson(url);

    if (!Array.isArray(payload)) {
      throw new Error(`data-api /holders unexpected payload shape at ${url}`);
    }
    return payload as MarketHoldersRaw[];
  }

  /**
   * Закрытые (resolved) позиции кошелька из data-api /closed-positions.
   * Источник winRate/edge/avgEntry для скоринга внешних (discovered) кошельков,
   * у которых нет локальных Trade.
   */
  async fetchClosedPositions(address: string): Promise<ClosedPositionRaw[]> {
    const base = this.resolveDataApiUrl();
    const limit = DEFAULT_PAGE_LIMIT;
    const result: ClosedPositionRaw[] = [];
    let offset = 0;

    // Жёсткий потолок страниц: защита от бесконечной пагинации, если API
    // аномально отдаёт ровно `limit` записей. 40*500 = 20k позиций — с запасом.
    for (let page = 0; page < CLOSED_POSITIONS_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        user: address,
        limit: String(limit),
        offset: String(offset),
      });

      const url = `${base}/closed-positions?${params}`;
      const payload = await this.fetchJson(url);

      if (!Array.isArray(payload)) {
        throw new Error(`data-api /closed-positions unexpected payload shape at ${url}`);
      }

      const rows = payload as ClosedPositionRaw[];
      result.push(...rows);

      if (rows.length < limit) {
        break;
      }
      offset += limit;
    }

    return result;
  }

  /**
   * Лента сделок из data-api /trades. Для дискавери: свежие proxyWallet по рынку
   * или глобально. Одна страница (firehose), без авто-пагинации.
   */
  async fetchRecentTrades(
    opts: { market?: string; limit?: number; offset?: number } = {},
  ): Promise<DataApiTradeRaw[]> {
    const base = this.resolveDataApiUrl();
    const params = new URLSearchParams({
      limit: String(opts.limit ?? DEFAULT_HOLDERS_LIMIT),
      offset: String(opts.offset ?? 0),
    });
    if (opts.market !== undefined && opts.market.length > 0) {
      params.set("market", opts.market);
    }

    const url = `${base}/trades?${params}`;
    const payload = await this.fetchJson(url);

    if (!Array.isArray(payload)) {
      throw new Error(`data-api /trades unexpected payload shape at ${url}`);
    }
    return payload as DataApiTradeRaw[];
  }

  /**
   * Прибыль кошелька из lb-api /profit для указанного окна.
   * Возвращает null, если ответ — пустой массив.
   */
  async fetchLbProfit(address: string, window: LbProfitWindow): Promise<LbProfitResult | null> {
    const base = this.resolveLbApiUrl();
    const params = new URLSearchParams({
      window,
      limit: "1",
      address,
    });

    const url = `${base}/profit?${params}`;
    const payload = await this.fetchJson(url);

    if (!Array.isArray(payload)) {
      throw new Error(`lb-api /profit unexpected payload shape at ${url}`);
    }

    if (payload.length === 0) {
      return null;
    }

    return payload[0] as LbProfitResult;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const timeoutMs = this.resolveTimeoutMs();
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new DataApiTimeoutError(url));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        fetch(url, { signal: controller.signal }),
        timeoutPromise,
      ]);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new DataApiUpstreamError(response.status, body, url);
      }

      return await response.json();
    } catch (err: unknown) {
      if (err instanceof DataApiUpstreamError || err instanceof DataApiTimeoutError) {
        throw err;
      }
      // AbortError от controller.abort() после таймаута — уже заброшен DataApiTimeoutError выше
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        throw new DataApiTimeoutError(url);
      }
      throw err;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private resolveDataApiUrl(): string {
    const raw = this.configService.get<string>("POLYMARKET_DATA_API_URL");
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim().replace(/\/$/, "");
    }
    return DEFAULT_POLYMARKET_DATA_API_URL;
  }

  private resolveLbApiUrl(): string {
    const raw = this.configService.get<string>("POLYMARKET_LB_API_URL");
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim().replace(/\/$/, "");
    }
    return DEFAULT_POLYMARKET_LB_API_URL;
  }

  private resolveTimeoutMs(): number {
    const raw = this.configService.get<string>("POLYMARKET_HTTP_TIMEOUT_MS");
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_TIMEOUT_MS;
  }

  private resolvePageDelayMs(): number {
    const raw = this.configService.get<string>("POLYMARKET_BACKFILL_PAGE_DELAY_MS");
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return 0;
    }
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
}
