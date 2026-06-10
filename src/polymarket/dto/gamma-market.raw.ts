/**
 * Сырой объект маркета из Gamma API (`gamma-api.polymarket.com/markets`).
 * Поля в snake_case и camelCase — в ответе встречаются оба варианта.
 */
export type GammaMarketRaw = Record<string, unknown> & {
  readonly conditionId?: unknown;
  readonly condition_id?: unknown;
  readonly question?: unknown;
  readonly slug?: unknown;
  readonly market_slug?: unknown;
  readonly clobTokenIds?: unknown;
  readonly outcomes?: unknown;
  readonly outcomePrices?: unknown;
  readonly closed?: unknown;
  readonly active?: unknown;
  readonly volume24hr?: unknown;
  readonly liquidityNum?: unknown;
  readonly liquidity?: unknown;
  readonly endDateIso?: unknown;
  readonly end_date_iso?: unknown;
  readonly category?: unknown;
  readonly tags?: unknown;
  readonly series?: unknown;
};
