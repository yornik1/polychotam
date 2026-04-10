export type TradeSide = "BUY" | "SELL";
export type TradeTraderSide = "TAKER" | "MAKER";

export interface TradeEvent {
  wallet: string;
  amount: string;
  side: TradeSide;
  price: string;
  market: string;
  assetId: string;
  timestamp: number;
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

export interface WalletUpsertInput {
  address: string;
  total_won: string;
  total_lost: string;
  win_rate: string;
  trade_count: number;
}

export interface MarketResolution {
  condition_id: string;
  winning_token_id: string | null;
  winning_outcome: string | null;
}

export interface WalletRecalculateJob {
  address: string;
}

export interface TradeEnrichmentJob {
  tradeRecordId: string;
  market: string;
  assetId: string;
  side: TradeSide;
  amount: string;
  price: string;
  timestamp: number;
}

/** Job пагинации deep backfill в очереди `trades`. */
export interface TradesBackfillPageJob {
  conditionId: string;
  offset: number;
}
