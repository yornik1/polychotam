import type { GammaMarketRaw } from "../polymarket/dto/gamma-market.raw.js";

/** Допустимые категории маркета. */
export type MarketCategory = "politics" | "sports" | "crypto" | "other";

// Ключевые слова для нормализации прямого поля category
const POLITICS_CATEGORY_KEYWORDS = ["election", "politics", "geopolitics", "political"];
const SPORTS_CATEGORY_KEYWORDS = ["sports", "sport", "nba", "nfl", "mlb", "nhl", "soccer", "epl", "atp", "wta", "football", "basketball", "baseball", "hockey", "tennis"];
const CRYPTO_CATEGORY_KEYWORDS = ["crypto", "bitcoin", "ethereum", "defi", "nft", "blockchain"];

// Slug-эвристики: префиксы и фрагменты
const SPORTS_SLUG_PATTERNS = /mlb-|nba-|nfl-|nhl-|atp-|wta-|epl-/i;
const CRYPTO_SLUG_PATTERNS = /btc|bitcoin|eth(?:ereum)?|crypto/i;
const POLITICS_SLUG_PATTERNS = /election|president|senate|mayor|minister|congress|parliament/i;

/**
 * Определяет категорию маркета по данным из Gamma API.
 * Порядок приоритетов:
 *   1. Прямое поле category (нормализованное)
 *   2. Поле tags (массив строк или строка)
 *   3. Поле series (строка)
 *   4. Slug-эвристика
 *   5. other
 */
export function mapGammaCategory(raw: GammaMarketRaw): MarketCategory {
  // 1. Прямое поле category
  if (typeof raw.category === "string" && raw.category.trim().length > 0) {
    const normalized = raw.category.trim().toLowerCase();
    const fromCategory = normalizeCategoryString(normalized);
    if (fromCategory !== null) {
      return fromCategory;
    }
  }

  // 2. Tags
  const tagsResult = findCategoryInTags(raw.tags);
  if (tagsResult !== null) {
    return tagsResult;
  }

  // 3. Series
  if (typeof raw.series === "string" && raw.series.trim().length > 0) {
    const fromSeries = normalizeCategoryString(raw.series.trim().toLowerCase());
    if (fromSeries !== null) {
      return fromSeries;
    }
  }

  // 4. Slug-эвристика
  const slug =
    typeof raw.slug === "string"
      ? raw.slug
      : typeof raw.market_slug === "string"
        ? raw.market_slug
        : "";

  if (slug.length > 0) {
    if (SPORTS_SLUG_PATTERNS.test(slug)) {
      return "sports";
    }
    if (CRYPTO_SLUG_PATTERNS.test(slug)) {
      return "crypto";
    }
    if (POLITICS_SLUG_PATTERNS.test(slug)) {
      return "politics";
    }
  }

  return "other";
}

/** Нормализует строку в категорию или возвращает null если не распознано. */
function normalizeCategoryString(s: string): MarketCategory | null {
  if (POLITICS_CATEGORY_KEYWORDS.some((kw) => s.includes(kw))) {
    return "politics";
  }
  if (SPORTS_CATEGORY_KEYWORDS.some((kw) => s.includes(kw))) {
    return "sports";
  }
  if (CRYPTO_CATEGORY_KEYWORDS.some((kw) => s.includes(kw))) {
    return "crypto";
  }
  return null;
}

/** Ищет категорию в поле tags (массив строк или одна строка). */
function findCategoryInTags(tags: unknown): MarketCategory | null {
  let candidates: string[] = [];

  if (Array.isArray(tags)) {
    candidates = tags.filter((t): t is string => typeof t === "string");
  } else if (typeof tags === "string" && tags.trim().length > 0) {
    candidates = [tags];
  }

  for (const tag of candidates) {
    const result = normalizeCategoryString(tag.toLowerCase());
    if (result !== null) {
      return result;
    }
  }

  return null;
}
