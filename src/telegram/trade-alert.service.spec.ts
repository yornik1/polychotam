import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { MarketsService } from "../markets/markets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { TelegramService } from "./telegram.service.js";
import { TradeAlertService } from "./trade-alert.service.js";

describe("TradeAlertService", () => {
  function createService(overrides?: {
    threshold?: string;
    dedupTtlMs?: string;
    isTopWhale?: boolean;
    isTopMarket?: boolean;
    sendAlert?: boolean;
    marketLabel?: { question?: string; market_slug?: string } | null;
  }) {
    const sendAlert = vi.fn().mockResolvedValue(overrides?.sendAlert ?? true);
    const getTopWalletsByVolumeOnTopMarkets = vi
      .fn<() => Promise<Array<{ address: string; totalVolume: string; tradeCount: number }>>>()
      .mockResolvedValue(
        overrides?.isTopWhale
          ? [{ address: "0xmaker", totalVolume: "5000000", tradeCount: 100 }]
          : [],
      );
    const isTopMarket = vi
      .fn<(conditionId: string, limit?: number) => Promise<boolean>>()
      .mockResolvedValue(overrides?.isTopMarket ?? true);
    const findByConditionId = vi
      .fn<(conditionId: string) => Promise<{ question?: string; market_slug?: string } | null>>()
      .mockResolvedValue(overrides?.marketLabel ?? null);
    const get = vi.fn((key: string) => {
      if (key === "ALERT_THRESHOLD_AMOUNT") {
        return overrides?.threshold;
      }
      if (key === "ALERT_DEDUP_TTL_MS") {
        return overrides?.dedupTtlMs;
      }

      return undefined;
    });

    const service = new TradeAlertService(
      { get } as unknown as ConfigService,
      { findByConditionId, isTopMarket } as unknown as MarketsService,
      { getTopWalletsByVolumeOnTopMarkets } as unknown as WalletsService,
      { sendAlert } as unknown as TelegramService,
    );

    return { service, getTopWalletsByVolumeOnTopMarkets, isTopMarket, sendAlert, findByConditionId };
  }

  it("отправляет alert для top-wallet при сумме выше порога", async () => {
    const { service, getTopWalletsByVolumeOnTopMarkets, isTopMarket, sendAlert } = createService({
      threshold: "1000",
      isTopWhale: true,
      isTopMarket: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(true);

    expect(getTopWalletsByVolumeOnTopMarkets).toHaveBeenCalled();
    expect(isTopMarket).toHaveBeenCalledWith("0xmarket", 20);
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("0xmaker"));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("$1500"));
  });

  it("не отправляет alert, если сумма ниже порога", async () => {
    const { service, getTopWalletsByVolumeOnTopMarkets, sendAlert } = createService({
      threshold: "1000",
      isTopWhale: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "999",
      }),
    ).resolves.toBe(false);

    expect(getTopWalletsByVolumeOnTopMarkets).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("отправляет alert при сумме ровно на пороге", async () => {
    const { service, getTopWalletsByVolumeOnTopMarkets, sendAlert } = createService({
      threshold: "1000",
      isTopWhale: true,
      isTopMarket: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1000",
      }),
    ).resolves.toBe(true);

    expect(getTopWalletsByVolumeOnTopMarkets).toHaveBeenCalled();
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it("не отправляет alert, если кошелёк не входит в top-10", async () => {
    const { service, sendAlert, isTopMarket } = createService({
      threshold: "1000",
      isTopWhale: false,
      isTopMarket: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(false);

    expect(isTopMarket).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("не отправляет alert, если маркет не входит в топ-20", async () => {
    const { service, sendAlert, getTopWalletsByVolumeOnTopMarkets, isTopMarket } = createService({
      threshold: "1000",
      isTopWhale: true,
      isTopMarket: false,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(false);

    expect(getTopWalletsByVolumeOnTopMarkets).toHaveBeenCalled();
    expect(isTopMarket).toHaveBeenCalledWith("0xmarket", 20);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("возвращает false, если TelegramService не смог отправить alert", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isTopWhale: true,
      isTopMarket: true,
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
      isTopWhale: true,
      isTopMarket: true,
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

  it("не дублирует alert при повторном вызове с тем же tradeTimestamp в окне dedup", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isTopWhale: true,
      isTopMarket: true,
      dedupTtlMs: "60000",
    });

    const payload = {
      address: "0xmaker",
      market: "0xmarket",
      side: "BUY" as const,
      amount: "1500",
      tradeTimestamp: 1_700_000_001,
    };

    await expect(service.maybeSendTradeAlert(payload)).resolves.toBe(true);
    await expect(service.maybeSendTradeAlert(payload)).resolves.toBe(false);

    expect(sendAlert).toHaveBeenCalledTimes(1);
  });
});
