import { createHash } from "node:crypto";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";

type TradeIdentity = Pick<
  TradeEvent,
  "market" | "assetId" | "timestamp" | "side" | "price" | "amount"
>;

export function buildWsTradeRecordId(event: TradeIdentity): string {
  const raw = `${event.market}|${event.assetId}|${event.timestamp}|${event.side}|${event.price}|${event.amount}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return `ws:${hash}`;
}
