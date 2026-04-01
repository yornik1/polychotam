/**
 * Сырой объект маркета из Polymarket CLOB API (/markets).
 * Поля не валидированы — типы unknown, проверка происходит в маппере.
 */
export interface PolymarketMarketRaw {
  readonly condition_id: unknown;
  readonly question: unknown;
  readonly market_slug: unknown;
  /**
   * Массив токенов маркета; из него извлекаются outcomes через поле outcome каждого токена.
   * Пример: [{ token_id: "...", outcome: "Yes" }, { token_id: "...", outcome: "No" }]
   */
  readonly tokens: unknown;
  readonly active: unknown;
  readonly closed: unknown;
  readonly liquidity: unknown;
  readonly volume24hr: unknown;
  readonly end_date_iso: unknown;
  readonly [key: string]: unknown;
}
