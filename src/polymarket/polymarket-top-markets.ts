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

/**
 * Выбирает топ `limit` маркетов по volume24hr (убывание, стабильно при равенстве — по исходному индексу).
 * Возвращает **token_id** (asset id) для подписки на market channel CLOB (`assets_ids`), по одному рынку — все его токены.
 *
 * Сверка с докой: https://docs.polymarket.com/developers/CLOB/websocket/market-channel
 */
export function pickTopMarketsByVolume(
  markets: readonly PolymarketMarketRaw[],
  limit: number
): string[] {
  if (limit <= 0) {
    return [];
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
  const unique = new Set<string>();
  for (const { market } of picked) {
    for (const tokenId of extractTokenIds(market.tokens)) {
      unique.add(tokenId);
    }
  }
  return [...unique];
}
