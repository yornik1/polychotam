import { Injectable } from "@nestjs/common";
import {
  MarketScore,
  MarketScoreConclusionCode,
  MarketScoreDataGapCode,
  MarketScoreInput,
  MarketScoreReason,
} from "../types/contracts.js";

interface MarketTokenLike {
  outcome?: unknown;
  price?: unknown;
}

@Injectable()
export class MarketScoreService {
  scoreMarket(market: MarketScoreInput): MarketScore {
    const reasons: MarketScoreReason[] = [];
    const dataGaps: MarketScoreDataGapCode[] = [];
    let rawScore = 50;
    const isTradable = market.active && !market.closed && market.accepting_orders === true;

    if (isTradable) {
      rawScore += 10;
      reasons.push({
        code: "tradable_status",
        impact: "positive",
      });
    } else {
      rawScore -= 25;
      dataGaps.push("not_tradable");
      reasons.push({
        code: "not_tradable_status",
        impact: "negative",
      });
    }

    const validPrices = this.extractValidPrices(market.tokens);
    if (validPrices.length >= 2) {
      rawScore += 10;
      reasons.push({
        code: "valid_prices",
        impact: "positive",
      });
    } else {
      rawScore -= 15;
      dataGaps.push("missing_prices");
    }

    if (market.volume24hr >= 100_000) {
      rawScore += 15;
      reasons.push({
        code: "high_volume24hr",
        impact: "positive",
        value: market.volume24hr,
      });
    } else if (market.volume24hr > 0) {
      rawScore += 5;
      reasons.push({
        code: "some_volume24hr",
        impact: "neutral",
        value: market.volume24hr,
      });
    } else {
      rawScore -= 10;
      dataGaps.push("missing_volume24hr");
    }

    if (market.liquidity >= 25_000) {
      rawScore += 10;
      reasons.push({
        code: "high_liquidity",
        impact: "positive",
        value: market.liquidity,
      });
    } else if (market.liquidity > 0) {
      rawScore += 3;
      reasons.push({
        code: "some_liquidity",
        impact: "neutral",
        value: market.liquidity,
      });
    } else {
      rawScore -= 10;
      dataGaps.push("missing_liquidity");
    }

    if (market.end_date_iso === null) {
      dataGaps.push("missing_end_date");
    }

    const hasEnoughData =
      isTradable &&
      validPrices.length >= 2 &&
      market.volume24hr > 0 &&
      market.liquidity > 0;
    const score = this.clampScore(hasEnoughData ? rawScore : Math.min(rawScore, 50));

    return {
      score,
      conclusion: this.buildConclusion(score, hasEnoughData),
      reasons: reasons.slice(0, 4),
      dataGaps,
      hasEnoughData,
    };
  }

  private extractValidPrices(tokens: unknown): number[] {
    if (!Array.isArray(tokens)) {
      return [];
    }

    return tokens
      .filter((token): token is MarketTokenLike => typeof token === "object" && token !== null)
      .map((token) => {
        const rawPrice = token.price;
        return typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? Number(rawPrice) : Number.NaN;
      })
      .filter((price) => Number.isFinite(price) && price >= 0 && price <= 1);
  }

  private clampScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private buildConclusion(score: number, hasEnoughData: boolean): MarketScoreConclusionCode {
    if (!hasEnoughData) {
      return "insufficient_data";
    }

    if (score >= 75) {
      return "strong_watch";
    }

    if (score >= 55) {
      return "medium_watch";
    }

    return "weak_signal";
  }
}
