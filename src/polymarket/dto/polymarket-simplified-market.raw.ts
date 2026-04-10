export interface PolymarketSimplifiedTokenRaw {
  readonly token_id: unknown;
  readonly outcome: unknown;
  readonly price?: unknown;
  readonly winner?: unknown;
}

export interface PolymarketSimplifiedMarketRaw {
  readonly condition_id: unknown;
  readonly rewards?: unknown;
  readonly tokens: unknown;
  readonly active: unknown;
  readonly closed: unknown;
  readonly archived?: unknown;
  readonly accepting_orders?: unknown;
  readonly [key: string]: unknown;
}
