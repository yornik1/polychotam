import { describe, expect, it } from "vitest";
import type { GammaMarketRaw } from "./dto/gamma-market.raw.js";
import {
  buildTokensJsonFromGamma,
  deriveWinningTokenIdFromGamma,
  gammaConditionId,
  gammaLiquidityNum,
  gammaVolume24hr,
  gammaWinningOutcome,
  parseClobTokenIdsFromGamma,
} from "./polymarket-gamma.util.js";

describe("polymarket-gamma.util", () => {
  it("поддерживает текущую live-форму Gamma со строковыми и числовыми полями", () => {
    const market: GammaMarketRaw = {
      conditionId: "0xgamma-live",
      clobTokenIds: ["token-yes", "token-no"],
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.44", "0.56"],
      liquidityNum: 12345.67,
      volume24hr: "9876.54",
    };

    expect(parseClobTokenIdsFromGamma(market.clobTokenIds)).toEqual([
      "token-yes",
      "token-no",
    ]);
    expect(gammaConditionId(market)).toBe("0xgamma-live");
    expect(gammaLiquidityNum(market)).toBe(12345.67);
    expect(gammaVolume24hr(market)).toBe(9876.54);
    expect(buildTokensJsonFromGamma(market)).toEqual([
      { token_id: "token-yes", outcome: "Yes", price: "0.44" },
      { token_id: "token-no", outcome: "No", price: "0.56" },
    ]);
  });

  it("поддерживает doc/live-форму Gamma со строкифицированными JSON-массивами", () => {
    const closedMarket: GammaMarketRaw = {
      conditionId: "0xgamma-closed",
      clobTokenIds: "[\"tok-yes\",\"tok-no\"]",
      outcomes: "[\"Yes\",\"No\"]",
      outcomePrices: "[\"1\",\"0\"]",
      liquidity: "345.12",
      volume24hr: "789.01",
    };

    expect(parseClobTokenIdsFromGamma(closedMarket.clobTokenIds)).toEqual([
      "tok-yes",
      "tok-no",
    ]);
    expect(gammaLiquidityNum(closedMarket)).toBe(345.12);
    expect(gammaVolume24hr(closedMarket)).toBe(789.01);
    expect(deriveWinningTokenIdFromGamma(closedMarket)).toBe("tok-yes");
    expect(gammaWinningOutcome(closedMarket)).toBe("Yes");
    expect(buildTokensJsonFromGamma(closedMarket)).toEqual([
      { token_id: "tok-yes", outcome: "Yes", price: "1" },
      { token_id: "tok-no", outcome: "No", price: "0" },
    ]);
  });
});
