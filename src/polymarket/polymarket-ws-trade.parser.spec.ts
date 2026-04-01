import { describe, expect, it } from "vitest";
import {
  parseTradeEventsFromWsPayload,
  POLYMARKET_WS_LAST_TRADE_PRICE,
} from "./polymarket-ws-trade.parser.js";

describe("parseTradeEventsFromWsPayload", () => {
  it("парсит last_trade_price из доки Polymarket", () => {
    const docExample = {
      asset_id: "114122071509644379678018727908709560226618148003371446110114509806601493071694",
      event_type: POLYMARKET_WS_LAST_TRADE_PRICE,
      fee_rate_bps: "0",
      market: "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347",
      price: "0.456",
      side: "BUY",
      size: "219.217767",
      timestamp: "1750428146322",
    };
    const trades = parseTradeEventsFromWsPayload(docExample);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toEqual({
      wallet: "",
      amount: "219.217767",
      side: "BUY",
      price: "0.456",
      market: "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347",
      assetId: "114122071509644379678018727908709560226618148003371446110114509806601493071694",
      timestamp: 1750428146322,
    });
  });

  it("обрабатывает массив сообщений", () => {
    const trades = parseTradeEventsFromWsPayload([
      {
        event_type: "book",
        asset_id: "x",
        market: "0x1",
      },
      {
        asset_id: "a2",
        event_type: POLYMARKET_WS_LAST_TRADE_PRICE,
        market: "0xm",
        price: "0.5",
        side: "SELL",
        size: "10",
        timestamp: 100,
      },
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.side).toBe("SELL");
  });

  it("возвращает [] для неизвестного event_type", () => {
    expect(parseTradeEventsFromWsPayload({ event_type: "book", asset_id: "1" })).toEqual([]);
  });

  it("возвращает [] при невалидных полях сделки", () => {
    expect(
      parseTradeEventsFromWsPayload({
        event_type: POLYMARKET_WS_LAST_TRADE_PRICE,
        asset_id: "",
        side: "BUY",
        size: "1",
        price: "0.5",
        timestamp: 1,
      })
    ).toEqual([]);
    expect(
      parseTradeEventsFromWsPayload({
        event_type: POLYMARKET_WS_LAST_TRADE_PRICE,
        asset_id: "a",
        side: "HOLD",
        size: "1",
        price: "0.5",
        timestamp: 1,
      })
    ).toEqual([]);
  });
});
