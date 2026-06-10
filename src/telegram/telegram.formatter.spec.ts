import { describe, expect, it } from "vitest";
import { Market } from "../markets/market.entity.js";
import type { SmartWalletStats } from "../wallets/smart-wallets.service.js";
import type { MarketScore, WalletPnlV2Summary, WalletScoreSpecialization } from "../types/contracts.js";
import type { WalletScore } from "../wallets/wallet-score.entity.js";
import {
  formatMarketMessage,
  formatMarketScoreChoicesMessage,
  formatMarketScoreMessage,
  formatWalletPnlV2Message,
  formatSmartWhaleAlertMessage,
  formatStartMessage,
  formatStatsMessage,
  formatTopSmartWalletsMessage,
} from "./telegram.formatter.js";

describe("telegram formatter", () => {
  function walletPnlV2Summary(input: Partial<WalletPnlV2Summary> = {}): WalletPnlV2Summary {
    return {
      address: "0xabcdef1234567890",
      window: "90d",
      method: "cash_flow_wallet_activity",
      realizedPnl: -199.4,
      openPositionsValue: 191.06,
      totalPnl: -8.34,
      byOperation: {},
      hypothesisTypes: [],
      dataGaps: [],
      validated: true,
      computedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      ...input,
    };
  }

  it("formatStartMessage возвращает список команд без админских", () => {
    const msg = formatStartMessage();
    expect(msg).toContain("/top");
    expect(msg).toContain("/market");
    expect(msg).toContain("/score");
    expect(msg).toContain("/pnl");
    // админ-команды скрыты от пользователя
    expect(msg).not.toContain("/queues");
    expect(msg).not.toContain("/errors");
    expect(msg).not.toContain("/ws");
    expect(msg).not.toContain("/alerts");
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
        tokens: [
          { outcome: "Yes", price: "0.62" },
          { outcome: "No", price: "0.38" },
        ],
      } as Market,
      score,
    );

    expect(message).toContain("Will BTC hit $100k?");
    expect(message).toContain("Score: 82/100");
    expect(message).toContain("Odds: Yes 62% / No 38%");
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
        tokens: [
          { outcome: "YES", price: "0.62" },
          { outcome: "NO", price: "0.38" },
        ],
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
    expect(message).toContain("YES 72%");
    expect(message).toContain("NO 28%");
    expect(message).toContain("$1,250,000");
    expect(message).toContain("2024-11-05");
  });

  it("formatWalletPnlV2Message показывает total/realized/open и служебную строку", () => {
    const message = formatWalletPnlV2Message(walletPnlV2Summary());

    expect(message).toContain("Wallet P&amp;L");
    expect(message).toContain("0xabcd");
    expect(message).toContain("Period: 90d");
    expect(message).toContain("Total P&amp;L: -$8");
    expect(message).toContain("Realized: -$199");
    expect(message).toContain("Open positions: +$191");
    expect(message).toContain("est. on-chain data · обновлено 5 мин назад");
  });

  it("formatWalletPnlV2Message: свежий снапшот — «обновлено только что»", () => {
    const message = formatWalletPnlV2Message(
      walletPnlV2Summary({ computedAt: new Date().toISOString() }),
    );

    expect(message).toContain("est. on-chain data · обновлено только что");
  });

  it("formatWalletPnlV2Message не содержит disclaimers", () => {
    // даже невалидированный кошелёк не получает дисклеймеров — валидация внутренняя
    const message = formatWalletPnlV2Message(
      walletPnlV2Summary({ validated: false, dataGaps: ["unknown activity type X: 2 records"] }),
    );

    for (const banned of ["Limitations", "Data gaps", "Scope", "estimate", "not full"]) {
      expect(message).not.toContain(banned);
    }
    // ровно одна служебная строка
    expect(message.match(/est\. on-chain data/g)).toHaveLength(1);
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

  function makeWalletScore(overrides: Partial<WalletScore> = {}): WalletScore {
    const spec: WalletScoreSpecialization = {
      politics: { winRate: 0.7, resolvedCount: 20 },
      sports: { winRate: 0.5, resolvedCount: 5 },
      crypto: { winRate: 0.6, resolvedCount: 10 },
      other: { winRate: null, resolvedCount: 0 },
    };
    return {
      address: "0xABCDEF1234567890abcdef",
      pnl_90d: "1500.00",
      win_rate: "0.63",
      profit_factor: "2.5",
      specialization: spec,
      sample_size: 45,
      score: "72.5",
      computed_at: new Date("2026-06-10T12:00:00.000Z"),
      internal_created_at: new Date("2026-06-10T12:00:00.000Z"),
      internal_updated_at: new Date("2026-06-10T12:00:00.000Z"),
      ...overrides,
    };
  }

  describe("formatTopSmartWalletsMessage", () => {
    it("показывает лейбл, PnL 90d, винрейт, специализацию и кол-во сделок", () => {
      const msg = formatTopSmartWalletsMessage([makeWalletScore()]);

      // лейбл — сокращённый адрес с ссылкой
      expect(msg).toContain("0xABCD");
      expect(msg).toContain("polymarket.com/profile/0xABCDEF1234567890abcdef");
      // PnL 90d
      expect(msg).toContain("+$1,500");
      // винрейт
      expect(msg).toContain("63.0%");
      // специализация — politics лидирует (resolvedCount=20)
      expect(msg).toContain("Politics");
      // кол-во сделок
      expect(msg).toContain("45 сделок");
    });

    it("определяет специализацию Crypto", () => {
      const spec: WalletScoreSpecialization = {
        politics: { winRate: 0.5, resolvedCount: 3 },
        sports: { winRate: 0.4, resolvedCount: 1 },
        crypto: { winRate: 0.8, resolvedCount: 25 },
        other: { winRate: null, resolvedCount: 0 },
      };
      const msg = formatTopSmartWalletsMessage([makeWalletScore({ specialization: spec })]);
      expect(msg).toContain("Crypto");
    });

    it("Mixed при равных категориях", () => {
      const spec: WalletScoreSpecialization = {
        politics: { winRate: 0.6, resolvedCount: 10 },
        sports: { winRate: 0.5, resolvedCount: 10 },
        crypto: { winRate: null, resolvedCount: 0 },
        other: { winRate: null, resolvedCount: 0 },
      };
      const msg = formatTopSmartWalletsMessage([makeWalletScore({ specialization: spec })]);
      expect(msg).toContain("Mixed");
    });

    it("Mixed при лидирующей категории other", () => {
      const spec: WalletScoreSpecialization = {
        politics: { winRate: null, resolvedCount: 0 },
        sports: { winRate: null, resolvedCount: 0 },
        crypto: { winRate: null, resolvedCount: 0 },
        other: { winRate: 0.6, resolvedCount: 30 },
      };
      const msg = formatTopSmartWalletsMessage([makeWalletScore({ specialization: spec })]);
      expect(msg).toContain("Mixed");
    });

    it("пустой список возвращает заглушку без падения", () => {
      const msg = formatTopSmartWalletsMessage([]);
      expect(msg).toContain("Рейтинг пока пуст");
      expect(msg).toContain("накапливаем данные");
    });

    it("экранирует HTML-символы в адресе", () => {
      // синтетический адрес с HTML-символами; убеждаемся что escapeHtml вызван
      const spec: WalletScoreSpecialization = {
        politics: { winRate: 0.6, resolvedCount: 10 },
        sports: { winRate: null, resolvedCount: 0 },
        crypto: { winRate: null, resolvedCount: 0 },
        other: { winRate: null, resolvedCount: 0 },
      };
      const wallet = makeWalletScore({ address: "0x<test>&addr", specialization: spec });
      const msg = formatTopSmartWalletsMessage([wallet]);
      // сырой адрес не должен попасть в HTML ни в href, ни в тексте
      expect(msg).not.toContain("0x<test>&addr");
      // href: URL-encoded; видимый текст: escapeHtml поверх усечённого адреса
      expect(msg).toContain("https://polymarket.com/profile/0x%3Ctest%3E%26addr");
      expect(msg).toContain("0x&lt;tes");
    });

    it("отрицательный PnL показывает минус", () => {
      const msg = formatTopSmartWalletsMessage([makeWalletScore({ pnl_90d: "-300.50" })]);
      expect(msg).toContain("-$301");
    });
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
