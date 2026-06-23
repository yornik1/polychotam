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

export type WalletPnlMethod = "resolved_only_local_trades" | "cash_flow_wallet_activity";

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
  /**
   * true — джоб поставлен фоновым backfill-фидером (ремонт старых unknown).
   * Processor резолвит maker_address, но НЕ шлёт ретро Telegram-алерт.
   */
  backfill?: boolean;
}

/** Job пагинации deep backfill в очереди `trades`. */
export interface TradesBackfillPageJob {
  conditionId: string;
  offset: number;
}

// ─── PnL v2 / Smart Score ───────────────────────────────────────────────────

/** Известные типы операций из data-api /activity. */
export type WalletActivityType =
  | "TRADE"
  | "REDEEM"
  | "SPLIT"
  | "MERGE"
  | "REWARD"
  | "CONVERSION"
  | "MAKER_REBATE";

/**
 * Тип поля `type` в записи активности — известный литерал или произвольная строка
 * (на случай новых типов от API, которые ещё не добавлены в WalletActivityType).
 */
export type WalletActivityRawType = WalletActivityType | (string & {});

/** Запись из data-api /activity (поля соответствуют ответу внешнего API). */
export interface WalletActivityRaw {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: WalletActivityRawType;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price?: number;
  asset?: string;
  side?: "BUY" | "SELL";
  outcomeIndex?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
  outcome?: string;
  name?: string;
  pseudonym?: string;
}

/** Запись из data-api /positions (поля соответствуют ответу внешнего API). */
export interface WalletPositionRaw {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  currentValue: number;
  initialValue?: number;
  cashPnl?: number;
  realizedPnl?: number;
  redeemable?: boolean;
  negativeRisk?: boolean;
  title?: string;
  slug?: string;
  outcome?: string;
}

/** Холдер токена из data-api /holders (поля соответствуют ответу внешнего API). */
export interface WalletHolderRaw {
  proxyWallet: string;
  asset: string;
  amount: number;
  outcomeIndex: number;
  name?: string;
  pseudonym?: string;
  bio?: string;
  displayUsernamePublic?: boolean;
  verified?: boolean;
  profileImage?: string;
  profileImageOptimized?: string;
}

/** Группа холдеров по токену (Yes/No) из data-api /holders. */
export interface MarketHoldersRaw {
  token: string;
  holders: WalletHolderRaw[];
}

/** Закрытая позиция из data-api /closed-positions (поля соответствуют ответу внешнего API). */
export interface ClosedPositionRaw {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice?: number;
  outcome?: string;
  outcomeIndex?: number;
  title?: string;
  slug?: string;
  endDate?: string;
  timestamp?: number;
}

/** Статистика внешнего (discovered) кошелька, выведенная из closed-positions. */
export interface DiscoveredWalletStats {
  /** Число resolved позиций (закрытых ставок). */
  sampleSize: number;
  /** Доля выигрышных позиций (realizedPnl>0) среди resolved, 0..1. */
  winRate: number;
  /** Суммарный realized PnL в USDC. */
  realizedPnl: number;
  /** ROI = realizedPnl / суммарный totalBought (cost basis); 0 при нулевой базе. */
  roi: number;
  /** Средняя цена входа (avgPrice) = средняя implied вероятность, которую платил кошелёк. */
  avgEntryPrice: number;
  /** Edge: winRate − avgEntryPrice (в долях). >0 — оценивает события точнее рынка. */
  edgeVsImplied: number;
  /** Insider-подскор: доля выигрышных входов с avgPrice < INSIDER_ENTRY_THRESHOLD. */
  insiderScore: number;
  /** Фермер near-resolution: avgEntryPrice > FARMER_AVG_ENTRY_THRESHOLD. */
  isFarmer: boolean;
  /** PnL вытянут одним выбросом (MAD/Hampel) — рейтинг хрупкий. */
  isOutlierDriven: boolean;
}

/** Сделка из ленты data-api /trades (для дискавери важен proxyWallet). */
export interface DataApiTradeRaw {
  proxyWallet: string;
  conditionId: string;
  side: TradeSide;
  size: number;
  price: number;
  timestamp: number;
  asset?: string;
  outcome?: string;
  outcomeIndex?: number;
  title?: string;
  slug?: string;
}

/** Допустимые окна для lb-api /profit (90d отсутствует в lb-api). */
export type LbProfitWindow = "1d" | "7d" | "30d" | "all";

/** Запись ответа lb-api /profit. */
export interface LbProfitResult {
  proxyWallet: string;
  amount: number;
  name?: string;
  pseudonym?: string;
}

/** Допустимые окна для PnL v2 (включает 90d, которого нет в lb-api). */
export type WalletPnlV2Window = "30d" | "90d" | "all";

/** Итог расчёта PnL v2 методом cash_flow_wallet_activity. */
export interface WalletPnlV2Summary {
  address: string;
  window: WalletPnlV2Window;
  method: "cash_flow_wallet_activity";
  realizedPnl: number;
  openPositionsValue: number;
  totalPnl: number;
  /** Разбивка потоков по типу операции. */
  byOperation: Record<string, number>;
  /** Типы операций, которые встретились и обработаны по гипотезе (SPLIT/MERGE/CONVERSION). */
  hypothesisTypes: string[];
  /** Описания пропусков / неизвестных типов операций. */
  dataGaps: string[];
  /** true — прошёл кросс-валидацию с lb-api в пределах ε. */
  validated: boolean;
  /** ISO-дата расчёта. */
  computedAt: string;
}

/** Результат кросс-валидации PnL v2 против lb-api. */
export interface WalletPnlDivergence {
  address: string;
  window: LbProfitWindow;
  pnlV2: number;
  lbAmount: number;
  diff: number;
  verdict: "pass" | "fail" | "investigate";
}

/** Специализация кошелька по категориям рынков (rolling 90d). */
export type WalletScoreSpecialization = Record<
  "politics" | "sports" | "crypto" | "other",
  { winRate: number | null; resolvedCount: number }
>;

/** Скоринговая запись кошелька. */
export interface WalletScore {
  address: string;
  pnl90d: number;
  winRate: number;
  profitFactor: number | null;
  specialization: WalletScoreSpecialization;
  sampleSize: number;
  score: number;
  /** ISO-дата расчёта. */
  computedAt: string;
}

/** Job для пересчёта PnL v2 конкретного кошелька. */
export interface WalletPnlRecalcJob {
  address: string;
}

/** Job для пересчёта Smart Score; пустой address = пересчёт всего пула. */
export interface SmartScoreRecalcJob {
  address?: string;
}
