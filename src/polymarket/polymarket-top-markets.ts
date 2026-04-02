import type { PolymarketMarketRaw } from "./dto/polymarket-market.raw.js";

/**
 * Объём за 24ч: в актуальном CLOB `/markets` поля `volume24hr` часто **нет** в JSON — тогда 0.
 * Пробуем несколько имён на случай расширения API.
 */
function volume24hrOf(market: PolymarketMarketRaw): number {
  const keys = ["volume24hr", "volume_24hr", "volume24HR", "volume"] as const;
  for (const key of keys) {
    const v = market[key];
    if (v === undefined || v === null || v === "") {
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }
  return 0;
}

/**
 * Когда объём недоступен, поднимаем рынки, по которым реальнее поймать события WS.
 * 3 — принимает ордера и не закрыт; 2 — активен и не закрыт; 1 — помечен active; 0 — остальное.
 */
function wsTradabilityScore(market: PolymarketMarketRaw): number {
  const active = market.active === true;
  const closed = market.closed === true;
  const accepting = market.accepting_orders === true;
  if (accepting && active && !closed) {
    return 3;
  }
  if (active && !closed) {
    return 2;
  }
  if (active) {
    return 1;
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
  /** 0–3, см. wsTradabilityScore (если объём везде 0 — по этому полю видно, почему рынок в топе). */
  readonly tradabilityScore: number;
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
 * Выбирает топ `limit` маркетов: сначала по убыванию объёма 24h (если CLOB его прислал),
 * при равенстве — по «торгуемости» (accepting_orders / active / closed), затем стабильно по индексу.
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
    const ta = wsTradabilityScore(a.market);
    const tb = wsTradabilityScore(b.market);
    if (tb !== ta) {
      return tb - ta;
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
      tradabilityScore: wsTradabilityScore(market),
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
