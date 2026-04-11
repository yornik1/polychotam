import type { GammaMarketRaw } from "./dto/gamma-market.raw.js";
import {
  gammaConditionId,
  gammaVolume24hr,
  parseClobTokenIdsFromGamma,
} from "./polymarket-gamma.util.js";
import type { TopMarketWsRow, TopMarketsWsSelection } from "./polymarket-top-markets.js";

function slugForGammaLog(market: GammaMarketRaw): string {
  const slug = market.slug;
  if (typeof slug === "string" && slug.trim().length > 0) {
    return slug.trim();
  }
  const ms = market.market_slug;
  if (typeof ms === "string" && ms.trim().length > 0) {
    return ms.trim();
  }
  const q = market.question;
  if (typeof q === "string" && q.trim().length > 0) {
    const t = q.trim();
    return t.length > 100 ? `${t.slice(0, 97)}...` : t;
  }
  return "(без slug)";
}

/**
 * Топ активных маркетов из Gamma (уже отсортированных API по volume24hr) + assets_ids для WS.
 */
export function buildTopMarketsWsSelectionFromGamma(
  markets: readonly GammaMarketRaw[],
  limit: number,
): TopMarketsWsSelection {
  if (limit <= 0) {
    return { rows: [], assetIds: [] };
  }

  const withIndex = markets.map((market, index) => ({ market, index }));
  const eligible = withIndex.filter(({ market }) => {
    const cid = gammaConditionId(market);
    return cid !== null && parseClobTokenIdsFromGamma(market.clobTokenIds).length > 0;
  });

  eligible.sort((a, b) => {
    const vb = gammaVolume24hr(b.market);
    const va = gammaVolume24hr(a.market);
    if (vb !== va) {
      return vb - va;
    }
    return a.index - b.index;
  });

  const picked = eligible.slice(0, limit);
  const rows: TopMarketWsRow[] = picked.map(({ market }, i) => {
    const conditionId = gammaConditionId(market) ?? "";
    const tokenIds = parseClobTokenIdsFromGamma(market.clobTokenIds);
    const active = market.active === true;
    const closed = market.closed === true;
    const tradabilityScore = active && !closed ? 3 : active ? 1 : 0;
    return {
      rank: i + 1,
      conditionId,
      slug: slugForGammaLog(market),
      volume24hr: gammaVolume24hr(market),
      tradabilityScore,
      tokenIds,
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
