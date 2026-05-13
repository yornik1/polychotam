import { describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import { Market } from "../markets/market.entity.js";
import { Trade } from "../trades/trade.entity.js";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { TelegramUpdate } from "./telegram.update.js";

interface ReplyContext {
  payload?: string;
  reply: (message: string) => unknown;
}

describe("TelegramUpdate", () => {
  function createUpdate() {
    const findBySlug = vi.fn<(slug: string) => Promise<Market | null>>();
    const getTopWalletsByVolumeOnTopMarkets = vi.fn<
      () => Promise<Array<{ address: string; totalVolume: string; tradeCount: number }>>
    >();

    const update = new TelegramUpdate(
      { findBySlug } as unknown as MarketsService,
      { getTopWalletsByVolumeOnTopMarkets } as unknown as WalletsService,
      {} as unknown as SmartWalletsService,
      {} as unknown as Repository<Trade>,
      {} as unknown as Repository<Market>,
    );

    return { update, findBySlug, getTopWalletsByVolumeOnTopMarkets };
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

  it("отвечает formatted top whales для /top", async () => {
    const { update, getTopWalletsByVolumeOnTopMarkets } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    getTopWalletsByVolumeOnTopMarkets.mockResolvedValue([
      { address: "0xABCDEF1234567890", totalVolume: "5000000", tradeCount: 150 },
      { address: "0x1234567890ABCDEF", totalVolume: "3000000", tradeCount: 80 },
    ]);

    await update.handleTop({ reply } as ReplyContext);

    expect(getTopWalletsByVolumeOnTopMarkets).toHaveBeenCalledWith(10);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("0xABCD"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("китов"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("5,000,000"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("150 trades"));
  });
});
