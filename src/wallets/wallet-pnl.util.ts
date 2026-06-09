import type { Trade } from "../trades/trade.entity.js";

export interface ResolvedTradePnlResult {
  pnl: number;
  risk: number;
  isWinningTrade: boolean;
}

export type ResolvedTradePnlOutcome =
  | ResolvedTradePnlResult
  | "invalid_numeric"
  | "unsupported_side";

/**
 * Общий расчёт PnL для уже-resolved сделки на maker_address.
 * Возвращает outcome-строку для невалидных значений, чтобы вызывающий код
 * мог отдельно собрать dataGaps/skipped reason.
 */
export function calculateResolvedTradePnl(
  trade: Pick<Trade, "asset_id" | "price" | "side" | "size">,
  winningTokenId: string,
): ResolvedTradePnlOutcome {
  const size = Number(trade.size);
  const price = Number(trade.price);
  if (!Number.isFinite(size) || !Number.isFinite(price) || size < 0 || price < 0 || price > 1) {
    return "invalid_numeric";
  }

  const isWinningToken = trade.asset_id === winningTokenId;
  const side = trade.side.toUpperCase();

  if (side === "BUY") {
    return {
      pnl: isWinningToken ? size * (1 - price) : -(size * price),
      risk: size * price,
      isWinningTrade: isWinningToken,
    };
  }

  if (side === "SELL") {
    return {
      pnl: isWinningToken ? -(size * (1 - price)) : size * price,
      risk: size * (1 - price),
      isWinningTrade: !isWinningToken,
    };
  }

  return "unsupported_side";
}
