import type { PolymarketMarketRaw } from "./dto/polymarket-market.raw.js";

/**
 * Объём за 24ч из сырого маркета (как в CLOB /markets).
 */
function volume24hrOf(market: PolymarketMarketRaw): number {
  const v = market.volume24hr;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Достаёт clob token_id из массива tokens маркета.
 */
function extractTokenIds(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) {
    return [];
  }
  const ids: string[] = [];
  for (const token of tokens) {
    if (typeof token !== "object" || token === null) {
      continue;
    }
    const id = (token as Record<string, unknown>).token_id;
    if (typeof id === "string") {
      const trimmed = id.trim();
      if (trimmed.length > 0) {
        ids.push(trimmed);
      }
    }
  }
  return ids;
}

function hasEligibleConditionId(market: PolymarketMarketRaw): boolean {
  const cid = market.condition_id;
  return typeof cid === "string" && cid.trim().length > 0;
}

function slugForLog(market: PolymarketMarketRaw): string {
  if (typeof market.market_slug === "string" && market.market_slug.trim().length > 0) {
    return market.market_slug.trim();
  }
  if (typeof market.question === "string" && market.question.trim().length > 0) {
    const q = market.question.trim();
    return q.length > 100 ? `${q.slice(0, 97)}...` : q;
  }
  return "(без slug)";
}

/** Одна строка топа для логов и подписки WS. */
export interface TopMarketWsRow {
  readonly rank: number;
  readonly conditionId: string;
  readonly slug: string;
  readonly volume24hr: number;
  /** clob token_id этого маркета (Yes/No и т.д.). */
  readonly tokenIds: readonly string[];
}

/**
 * Топ `limit` рынков по объёму + плоский список `assets_ids` для CLOB market channel.
 */
export interface TopMarketsWsSelection {
  readonly rows: readonly TopMarketWsRow[];
  readonly assetIds: readonly string[];
}

/**
 * Выбирает топ `limit` маркетов по volume24hr и возвращает строки для логов + уникальные token_id для подписки.
 *
 * Сверка с докой: https://docs.polymarket.com/developers/CLOB/websocket/market-channel
 */
export function buildTopMarketsWsSelection(
  markets: readonly PolymarketMarketRaw[],
  limit: number
): TopMarketsWsSelection {
  if (limit <= 0) {
    return { rows: [], assetIds: [] };
  }

  const withIndex = markets.map((market, index) => ({ market, index }));
  const eligible = withIndex.filter(
    ({ market }) => hasEligibleConditionId(market) && extractTokenIds(market.tokens).length > 0
  );

  eligible.sort((a, b) => {
    const va = volume24hrOf(a.market);
    const vb = volume24hrOf(b.market);
    if (vb !== va) {
      return vb - va;
    }
    return a.index - b.index;
  });

  const picked = eligible.slice(0, limit);
  const rows: TopMarketWsRow[] = picked.map(({ market }, i) => {
    const cid = market.condition_id;
    const conditionId = typeof cid === "string" ? cid.trim() : "";
    return {
      rank: i + 1,
      conditionId,
      slug: slugForLog(market),
      volume24hr: volume24hrOf(market),
      tokenIds: extractTokenIds(market.tokens),
    };
  });

  const unique = new Set<string>();
  for (const row of rows) {
    for (const tokenId of row.tokenIds) {
      unique.add(tokenId);
    }
  }

  return { rows, assetIds: [...unique] };
}

/**
 * Уникальные **token_id** для `assets_ids` (все исходы выбранных рынков).
 */
export function pickTopMarketsByVolume(
  markets: readonly PolymarketMarketRaw[],
  limit: number
): string[] {
  return [...buildTopMarketsWsSelection(markets, limit).assetIds];
}
