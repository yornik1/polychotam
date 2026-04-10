import { describe, expect, it } from "vitest";
import { buildWsTradeRecordId } from "./trade-id.util.js";

describe("buildWsTradeRecordId", () => {
  it("детерминированно строит id для одинакового payload", () => {
    const event = {
      market: "0xmarket",
      assetId: "asset-1",
      timestamp: 1700000000000,
      side: "BUY" as const,
      price: "0.456",
      amount: "219.217767",
    };

    expect(buildWsTradeRecordId(event)).toBe(buildWsTradeRecordId(event));
  });

  it("возвращает ws-prefixed sha256 id", () => {
    const id = buildWsTradeRecordId({
      market: "0xmarket",
      assetId: "asset-1",
      timestamp: 1700000000000,
      side: "SELL",
      price: "0.123",
      amount: "42",
    });

    expect(id).toMatch(/^ws:[a-f0-9]{64}$/);
  });
});
