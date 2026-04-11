import { isPlainRecord } from "./polymarket-ws-payload.util.js";

export interface MarketResolvedWsPayload {
  readonly conditionId: string;
  readonly winningAssetId: string;
  readonly winningOutcome: string;
}

/**
 * Разбор `event_type: market_resolved` (CLOB market channel, custom_feature_enabled).
 */
export function tryParseMarketResolvedWsPayload(
  payload: unknown,
): MarketResolvedWsPayload | null {
  if (!isPlainRecord(payload)) {
    return null;
  }
  if (payload["event_type"] !== "market_resolved") {
    return null;
  }
  const market = payload["market"];
  const winningAssetId = payload["winning_asset_id"];
  const winningOutcome = payload["winning_outcome"];
  if (typeof market !== "string" || market.trim().length === 0) {
    return null;
  }
  if (typeof winningAssetId !== "string" || winningAssetId.trim().length === 0) {
    return null;
  }
  const outcome =
    typeof winningOutcome === "string" && winningOutcome.trim().length > 0
      ? winningOutcome.trim()
      : "";
  return {
    conditionId: market.trim(),
    winningAssetId: winningAssetId.trim(),
    winningOutcome: outcome,
  };
}
