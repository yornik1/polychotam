import { describe, expect, it } from "vitest";
import { Market } from "../markets/market.entity.js";
import { Wallet } from "../wallets/wallet.entity.js";
import type { SmartWalletStats } from "../wallets/smart-wallets.service.js";
import type { MarketScore } from "../types/contracts.js";
import {
  formatMarketMessage,
  formatMarketScoreChoicesMessage,
  formatMarketScoreMessage,
  formatSmartWhaleAlertMessage,
  formatStartMessage,
  formatStatsMessage,
  formatTopWalletsMessage,
} from "./telegram.formatter.js";

describe("telegram formatter", () => {
  it("formatStartMessage возвращает список команд", () => {
    expect(formatStartMessage()).toContain("/top");
    expect(formatStartMessage()).toContain("/market");
    expect(formatStartMessage()).toContain("/score");
  });

  it("formatMarketScoreMessage показывает score, вывод и причины", () => {
    const score: MarketScore = {
      score: 82,
      conclusion: "strong_watch",
      reasons: [
        { code: "high_volume24hr", value: 250_000, impact: "positive" },
        { code: "high_liquidity", value: 75_000, impact: "positive" },
      ],
      dataGaps: [],
      hasEnoughData: true,
    };

    const message = formatMarketScoreMessage(
      {
        question: "Will BTC hit $100k?",
        market_slug: "btc-100k",
        condition_id: "condition-1",
      } as Market,
      score,
    );

    expect(message).toContain("Will BTC hit $100k?");
    expect(message).toContain("Score: 82/100");
    expect(message).toContain("Сильный рынок");
    expect(message).toContain("Объём");
    expect(message).toContain("btc-100k");
  });

  it("formatMarketScoreMessage честно показывает data gaps", () => {
    const score: MarketScore = {
      score: 40,
      conclusion: "insufficient_data",
      reasons: [],
      dataGaps: ["missing_prices", "missing_volume24hr"],
      hasEnoughData: false,
    };

    const message = formatMarketScoreMessage(
      {
        question: "Sparse market",
        market_slug: "sparse-market",
        condition_id: "condition-2",
      } as Market,
      score,
    );

    expect(message).toContain("Недостаточно данных");
    expect(message).toContain("Чего не хватает");
    expect(message).toContain("нет валидных цен исходов");
  });

  it("formatMarketScoreChoicesMessage показывает top markets и numbered follow-up", () => {
    const message = formatMarketScoreChoicesMessage([
      {
        question: "Will BTC hit $100k?",
        market_slug: "btc-100k",
        condition_id: "condition-1",
        volume24hr: 250_000,
      } as Market,
      {
        question: "Will ETH hit $10k?",
        market_slug: "eth-10k",
        condition_id: "condition-2",
        volume24hr: 125_000,
      } as Market,
    ]);

    expect(message).toContain("Выбери рынок");
    expect(message).toContain("1. Will BTC hit $100k?");
    expect(message).toContain("/score 1");
    expect(message).toContain("btc-100k");
    expect(message).toContain("$250,000");
  });

  it("formatMarketMessage показывает вопрос, odds, volume и close date", () => {
    const market = {
      question: "Trump wins 2024",
      volume24hr: 1250000,
      end_date_iso: "2024-11-05T00:00:00.000Z",
      tokens: [
        { outcome: "YES", price: 0.72 },
        { outcome: "NO", price: 0.28 },
      ],
    } as Market;

    const message = formatMarketMessage(market);

    expect(message).toContain("Trump wins 2024");
    expect(message).toContain("YES 0.72");
    expect(message).toContain("NO 0.28");
    expect(message).toContain("$1,250,000");
    expect(message).toContain("2024-11-05");
  });

  it("formatTopWalletsMessage форматирует топ кошельков списком", () => {
    const wallets = [
      {
        address: "0xABCDEF1234567890",
        win_rate: "0.78",
        total_won: "12400",
        total_lost: "3000",
        trade_count: 12,
      },
      {
        address: "0x9876543210FEDCBA",
        win_rate: "0.71",
        total_won: "8900",
        total_lost: "1200",
        trade_count: 8,
      },
    ] as Wallet[];

    const message = formatTopWalletsMessage(wallets);

    expect(message).toContain("Топ кошельков");
    expect(message).toContain("1.");
    expect(message).toContain("78%");
    expect(message).toContain("$12,400");
    expect(message).toContain("0xABCD");
  });

  it("formatSmartWhaleAlertMessage при null HR/ROI показывает n/a", () => {
    const stats: SmartWalletStats = {
      address: "0xabc",
      active: true,
      hit_rate: null,
      sum_pnl: null,
      roi_pct: null,
      whale_trade_count: 7,
      notes: "",
      source: "manual",
    };

    const message = formatSmartWhaleAlertMessage(
      { address: "0xabc", side: "BUY" },
      stats,
      "Some market",
      1500,
    );

    expect(message).toMatch(/HR.*n\/a/i);
    expect(message).toMatch(/ROI.*n\/a/i);
    expect(message).toContain("7");
  });

  it("formatStatsMessage включает WS connected for и uptime 24h", () => {
    const message = formatStatsMessage({
      tradesTotal: 100,
      trades24h: 10,
      marketsTotal: 20,
      marketsResolved: 5,
      smartWhalesActive: 3,
      wsConnectedForMs: (2 * 24 * 60 + 4 * 60 + 17) * 60 * 1000,
      wsUptimeRatio24h: 0.997,
    });

    expect(message).toContain("WS connected for:");
    expect(message).toContain("2d");
    expect(message).toContain("4h");
    expect(message).toContain("WS uptime (24h):");
    expect(message).toContain("99.7%");
  });
});
