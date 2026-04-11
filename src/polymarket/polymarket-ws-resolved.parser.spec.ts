import { describe, expect, it } from "vitest";
import { tryParseMarketResolvedWsPayload } from "./polymarket-ws-resolved.parser.js";

describe("tryParseMarketResolvedWsPayload", () => {
  it("парсит валидный market_resolved", () => {
    expect(
      tryParseMarketResolvedWsPayload({
        event_type: "market_resolved",
        market: "0xm",
        winning_asset_id: "tok1",
        winning_outcome: "Yes",
      }),
    ).toEqual({
      conditionId: "0xm",
      winningAssetId: "tok1",
      winningOutcome: "Yes",
    });
  });

  it("возвращает null для другого event_type", () => {
    expect(
      tryParseMarketResolvedWsPayload({ event_type: "book", market: "0xm" }),
    ).toBeNull();
  });
});
