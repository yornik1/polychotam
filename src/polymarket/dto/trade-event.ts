/**
 * Одна сделка из market channel CLOB (`last_trade_price`).
 * В payload Polymarket нет адреса кошелька — поле wallet оставляем пустым.
 */
export type TradeSide = "BUY" | "SELL";
export type TradeTraderSide = "TAKER" | "MAKER";

export interface TradeEvent {
  /** Адрес трейдера; для last_trade_price сейчас не приходит — пустая строка. */
  wallet: string;
  /** Объём (поле size в WS). */
  amount: string;
  side: TradeSide;
  price: string;
  /** condition id рынка (поле market в WS). */
  market: string;
  /** clob token_id (поле asset_id в WS). */
  assetId: string;
  timestamp: number;
  /** Канонический trade id из historical REST API. */
  tradeId?: string;
  owner?: string;
  takerOrderId?: string;
  makerAddress?: string;
  transactionHash?: string;
  outcome?: string;
  bucketIndex?: number;
  status?: string;
  traderSide?: TradeTraderSide;
  feeRateBps?: string;
  makerOrders?: unknown[];
}
