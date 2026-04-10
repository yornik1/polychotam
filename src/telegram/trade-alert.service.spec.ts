import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { MarketsService } from "../markets/markets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { TelegramService } from "./telegram.service.js";
import { TradeAlertService } from "./trade-alert.service.js";

describe("TradeAlertService", () => {
  function createService(overrides?: {
    threshold?: string;
    isTopWallet?: boolean;
    sendAlert?: boolean;
    marketLabel?: { question?: string; market_slug?: string } | null;
  }) {
    const sendAlert = vi.fn().mockResolvedValue(overrides?.sendAlert ?? true);
    const isTopWallet = vi
      .fn<(address: string) => Promise<boolean>>()
      .mockResolvedValue(overrides?.isTopWallet ?? true);
    const findByConditionId = vi
      .fn<(conditionId: string) => Promise<{ question?: string; market_slug?: string } | null>>()
      .mockResolvedValue(overrides?.marketLabel ?? null);
    const get = vi.fn((key: string) => {
      if (key === "ALERT_THRESHOLD_AMOUNT") {
        return overrides?.threshold;
      }

      return undefined;
    });

    const service = new TradeAlertService(
      { get } as unknown as ConfigService,
      { findByConditionId } as unknown as MarketsService,
      { isTopWallet } as unknown as WalletsService,
      { sendAlert } as unknown as TelegramService,
    );

    return { service, isTopWallet, sendAlert, findByConditionId };
  }

  it("отправляет alert для top-wallet при сумме выше порога", async () => {
    const { service, isTopWallet, sendAlert } = createService({
      threshold: "1000",
      isTopWallet: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(true);

    expect(isTopWallet).toHaveBeenCalledWith("0xmaker");
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("0xmaker"));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("$1500"));
  });

  it("не отправляет alert, если сумма ниже порога", async () => {
    const { service, isTopWallet, sendAlert } = createService({
      threshold: "1000",
      isTopWallet: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "999",
      }),
    ).resolves.toBe(false);

    expect(isTopWallet).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("отправляет alert при сумме ровно на пороге", async () => {
    const { service, isTopWallet, sendAlert } = createService({
      threshold: "1000",
      isTopWallet: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1000",
      }),
    ).resolves.toBe(true);

    expect(isTopWallet).toHaveBeenCalledWith("0xmaker");
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it("не отправляет alert, если кошелёк не входит в top-10", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isTopWallet: false,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(false);

    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("возвращает false, если TelegramService не смог отправить alert", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isTopWallet: true,
      sendAlert: false,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(false);

    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it("подставляет question маркета вместо сырого condition_id", async () => {
    const { service, sendAlert, findByConditionId } = createService({
      threshold: "1000",
      isTopWallet: true,
      marketLabel: {
        question: "Will BTC be above $100k?",
        market_slug: "btc-above-100k",
      },
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(true);

    expect(findByConditionId).toHaveBeenCalledWith("0xmarket");
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("Will BTC be above $100k?"));
    expect(sendAlert).not.toHaveBeenCalledWith(expect.stringContaining("Маркет: 0xmarket"));
  });
});
