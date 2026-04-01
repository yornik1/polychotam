import type { TradeEvent, TradeSide } from "./dto/trade-event.js";

/** Тип события сделки в market channel (см. доку Polymarket CLOB). */
export const POLYMARKET_WS_LAST_TRADE_PRICE = "last_trade_price";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTradeSide(value: unknown): value is TradeSide {
  return value === "BUY" || value === "SELL";
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Разбор одного объекта WS после JSON.parse.
 * Не бросает исключений; при неподходящей структуре возвращает [].
 */
export function parseTradeEventsFromWsPayload(payload: unknown): TradeEvent[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => parseTradeEventsFromWsPayload(item));
  }

  if (!isPlainRecord(payload)) {
    return [];
  }

  const eventType = payload["event_type"];
  if (eventType !== POLYMARKET_WS_LAST_TRADE_PRICE) {
    return [];
  }

  const assetId = asNonEmptyString(payload["asset_id"]);
  const priceRaw = payload["price"];
  const side = payload["side"];
  const sizeRaw = payload["size"];
  const marketRaw = payload["market"];
  const ts = parseTimestamp(payload["timestamp"]);

  if (assetId === null || ts === null || !isTradeSide(side)) {
    return [];
  }

  const price = typeof priceRaw === "string" ? priceRaw : priceRaw !== undefined ? String(priceRaw) : "";
  const amount = typeof sizeRaw === "string" ? sizeRaw : sizeRaw !== undefined ? String(sizeRaw) : "";
  const market = typeof marketRaw === "string" ? marketRaw : "";

  const event: TradeEvent = {
    wallet: "",
    amount,
    side,
    price,
    market,
    assetId,
    timestamp: ts,
  };

  return [event];
}
