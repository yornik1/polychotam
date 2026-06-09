import type { GammaMarketRaw } from "./dto/gamma-market.raw.js";

/** Парсит `clobTokenIds`: массив строк или JSON-строку `["id1","id2"]`. */
export function parseClobTokenIdsFromGamma(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim());
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** Парсит `outcomes` / `outcomePrices` как массив или JSON-строку. */
function parseStringArrayField(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x));
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x));
      }
    } catch {
      return [];
    }
  }
  return [];
}

export function gammaConditionId(market: GammaMarketRaw): string | null {
  const camel = market.conditionId;
  const snake = market.condition_id;
  const v = typeof camel === "string" ? camel : typeof snake === "string" ? snake : "";
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function gammaVolume24hr(market: GammaMarketRaw): number {
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

export function gammaLiquidityNum(market: GammaMarketRaw): number {
  const n = market.liquidityNum;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  const liq = market.liquidity;
  if (typeof liq === "number" && Number.isFinite(liq)) {
    return liq;
  }
  if (typeof liq === "string") {
    const parsed = Number(liq);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Для закрытого маркета по ценам исходов выбирает победивший clob token_id.
 * Обычно у победителя цена ≈ 1.
 */
export function deriveWinningTokenIdFromGamma(market: GammaMarketRaw): string | null {
  const tokens = parseClobTokenIdsFromGamma(market.clobTokenIds);
  if (tokens.length === 0) {
    return null;
  }
  const prices = parseStringArrayField(market.outcomePrices);
  if (prices.length !== tokens.length || prices.length === 0) {
    return null;
  }
  let bestIdx = -1;
  let bestPrice = -1;
  for (let i = 0; i < prices.length; i += 1) {
    const n = Number(prices[i]);
    if (Number.isFinite(n) && n > bestPrice) {
      bestPrice = n;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestPrice < 0.5) {
    return null;
  }
  const token = tokens[bestIdx];
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** JSON для колонки `tokens` (совместимо с CLOB-формой). */
export function buildTokensJsonFromGamma(market: GammaMarketRaw): Record<string, unknown>[] {
  const ids = parseClobTokenIdsFromGamma(market.clobTokenIds);
  const outcomes = parseStringArrayField(market.outcomes);
  const prices = parseStringArrayField(market.outcomePrices);
  return ids.map((token_id, i) => ({
    token_id,
    outcome: outcomes[i] ?? "",
    price: prices[i] ?? "",
  }));
}

export function gammaWinningOutcome(market: GammaMarketRaw): string | null {
  const tokens = parseClobTokenIdsFromGamma(market.clobTokenIds);
  const prices = parseStringArrayField(market.outcomePrices);
  const outcomes = parseStringArrayField(market.outcomes);
  if (
    outcomes.length !== tokens.length ||
    prices.length !== tokens.length ||
    outcomes.length === 0
  ) {
    return null;
  }
  let bestIdx = -1;
  let bestPrice = -1;
  for (let i = 0; i < prices.length; i += 1) {
    const n = Number(prices[i]);
    if (Number.isFinite(n) && n > bestPrice) {
      bestPrice = n;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestPrice < 0.5) {
    return null;
  }
  const o = outcomes[bestIdx];
  return typeof o === "string" && o.trim().length > 0 ? o.trim() : null;
}
