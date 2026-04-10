import { describe, expect, it } from "vitest";
import { Market } from "../markets/market.entity.js";
import { Wallet } from "../wallets/wallet.entity.js";
import {
  formatMarketMessage,
  formatStartMessage,
  formatTopWalletsMessage,
} from "./telegram.formatter.js";

describe("telegram formatter", () => {
  it("formatStartMessage возвращает список команд", () => {
    expect(formatStartMessage()).toContain("/top");
    expect(formatStartMessage()).toContain("/market");
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
});
