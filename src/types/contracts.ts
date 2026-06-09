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

export type WalletPnlMethod = "resolved_only_local_trades";

export type WalletPnlDataGapCode =
  | "unresolved_markets_excluded"
  | "invalid_numeric_trade_values"
  | "unsupported_trade_side"
  | "outside_period_excluded"
  | "maker_address_only"
  | "zero_risk_basis"
  | "no_resolved_trades";

export interface WalletPnlPeriod {
  from: string | null;
  days: number | null;
}

export interface WalletPnlQueryOptions {
  from?: Date;
  days?: number;
}

export interface WalletPnlSummary {
  address: string;
  method: WalletPnlMethod;
  period: WalletPnlPeriod;
  totalPnl: number;
  totalRisk: number;
  roi: number | null;
  winRate: number | null;
  includedTradeCount: number;
  skippedTradeCount: number;
  dataGaps: WalletPnlDataGapCode[];
  limitations: string[];
}

export interface MarketResolution {
  condition_id: string;
  winning_token_id: string | null;
  winning_outcome: string | null;
}

export type MarketScoreReasonImpact = "positive" | "neutral" | "negative";
export type MarketScoreConclusionCode = "insufficient_data" | "strong_watch" | "medium_watch" | "weak_signal";
export type MarketScoreReasonCode =
  | "tradable_status"
  | "not_tradable_status"
  | "valid_prices"
  | "high_volume24hr"
  | "some_volume24hr"
  | "high_liquidity"
  | "some_liquidity";
export type MarketScoreDataGapCode =
  | "not_tradable"
  | "missing_prices"
  | "missing_volume24hr"
  | "missing_liquidity"
  | "missing_end_date";

export interface MarketScoreInput {
  active: boolean;
  closed: boolean;
  accepting_orders: boolean | null;
  tokens: unknown;
  liquidity: number;
  volume24hr: number;
  end_date_iso: string | null;
}

export interface MarketScoreReason {
  code: MarketScoreReasonCode;
  impact: MarketScoreReasonImpact;
  value?: number;
}

export interface MarketScore {
  score: number;
  conclusion: MarketScoreConclusionCode;
  reasons: MarketScoreReason[];
  dataGaps: MarketScoreDataGapCode[];
  hasEnoughData: boolean;
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
