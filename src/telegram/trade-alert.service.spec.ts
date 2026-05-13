import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { TelegramService } from "./telegram.service.js";
import { TradeAlertService } from "./trade-alert.service.js";

describe("TradeAlertService", () => {
  function createService(overrides?: {
    threshold?: string;
    dedupTtlMs?: string;
    isSmartWhale?: boolean;
    sendAlert?: boolean;
    marketRecord?: { question?: string; market_slug?: string } | null;
  }) {
    const sendAlert = vi.fn().mockResolvedValue(overrides?.sendAlert ?? true);
    const isSmartWhale = vi
      .fn<(address: string) => Promise<boolean>>()
      .mockResolvedValue(overrides?.isSmartWhale ?? true);
    const findByConditionId = vi
      .fn<(conditionId: string) => Promise<{ question?: string; market_slug?: string } | null>>()
      .mockResolvedValue(overrides?.marketRecord ?? null);
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
      { findByConditionId } as unknown as MarketsService,
      { isSmartWhale } as unknown as SmartWalletsService,
      { sendAlert } as unknown as TelegramService,
    );

    return { service, isSmartWhale, sendAlert, findByConditionId };
  }

  it("отправляет alert для smart whale при сумме выше порога", async () => {
    const { service, isSmartWhale, sendAlert } = createService({
      threshold: "1000",
      isSmartWhale: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(true);

    expect(isSmartWhale).toHaveBeenCalledWith("0xmaker");
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("0xmaker"));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("1,500"));
  });

  it("не отправляет alert, если сумма ниже порога", async () => {
    const { service, isSmartWhale, sendAlert } = createService({
      threshold: "1000",
      isSmartWhale: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "999",
      }),
    ).resolves.toBe(false);

    expect(isSmartWhale).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("отправляет alert при сумме ровно на пороге", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isSmartWhale: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1000",
      }),
    ).resolves.toBe(true);

    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it("не отправляет alert, если адрес не в whitelist smart whales", async () => {
    const { service, sendAlert, findByConditionId } = createService({
      threshold: "1000",
      isSmartWhale: false,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(false);

    expect(findByConditionId).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("возвращает false, если TelegramService не смог отправить alert", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isSmartWhale: true,
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
      isSmartWhale: true,
      marketRecord: {
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
    expect(sendAlert).not.toHaveBeenCalledWith(expect.stringContaining("Market: 0xmarket"));
  });

  it("не дублирует alert при повторном вызове с тем же tradeTimestamp в окне dedup", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isSmartWhale: true,
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
