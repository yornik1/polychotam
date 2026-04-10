import { describe, expect, it, vi } from "vitest";
import { Market } from "../markets/market.entity.js";
import { MarketsService } from "../markets/markets.service.js";
import { Wallet } from "../wallets/wallet.entity.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { TelegramUpdate } from "./telegram.update.js";

interface ReplyContext {
  payload?: string;
  reply: (message: string) => unknown;
}

describe("TelegramUpdate", () => {
  function createUpdate() {
    const findBySlug = vi.fn<(slug: string) => Promise<Market | null>>();
    const getTopWallets = vi.fn<() => Promise<Wallet[]>>();

    const update = new TelegramUpdate(
      { findBySlug } as unknown as MarketsService,
      { getTopWallets } as unknown as WalletsService,
    );

    return { update, findBySlug, getTopWallets };
  }

  it("отвечает на /start списком команд", async () => {
    const { update } = createUpdate();
    const reply = vi.fn<(message: string) => void>();

    await update.handleStart({ reply } as ReplyContext);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/top"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/market"));
  });

  it("отвечает market summary для найденного slug", async () => {
    const { update, findBySlug } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    findBySlug.mockResolvedValue({
      question: "Trump wins 2024",
      volume24hr: 1250000,
      end_date_iso: "2024-11-05T00:00:00.000Z",
      tokens: [
        { outcome: "YES", price: 0.72 },
        { outcome: "NO", price: 0.28 },
      ],
    } as Market);

    await update.handleMarket({
      payload: "trump-win",
      reply,
    } as ReplyContext);

    expect(findBySlug).toHaveBeenCalledWith("trump-win");
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Trump wins 2024"));
  });

  it("сообщает об ошибке, если slug не найден", async () => {
    const { update, findBySlug } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    findBySlug.mockResolvedValue(null);

    await update.handleMarket({
      payload: "missing-market",
      reply,
    } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Маркет не найден. Попробуй другой slug.");
  });

  it("просит slug, если /market вызвали без аргумента", async () => {
    const { update } = createUpdate();
    const reply = vi.fn<(message: string) => void>();

    await update.handleMarket({
      payload: "   ",
      reply,
    } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Укажи slug: /market <slug>");
  });

  it("отвечает formatted top wallets для /top", async () => {
    const { update, getTopWallets } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    getTopWallets.mockResolvedValue([
      {
        address: "0xABCDEF1234567890",
        win_rate: "0.78",
        total_won: "12400",
        total_lost: "3000",
        trade_count: 12,
      },
    ] as Wallet[]);

    await update.handleTop({ reply } as ReplyContext);

    expect(getTopWallets).toHaveBeenCalledWith(10);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("0xABCD"));
  });
});
