import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { MarketsService } from "../markets/markets.service.js";
import type { SmartWalletStats } from "../wallets/smart-wallets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { FollowedWalletsService } from "../wallets/followed-wallets.service.js";
import { TelegramService } from "./telegram.service.js";
import { TradeAlertService } from "./trade-alert.service.js";

describe("TradeAlertService", () => {
  const defaultStats: SmartWalletStats = {
    address: "0xmaker",
    active: true,
    hit_rate: "0.65",
    sum_pnl: "1000",
    roi_pct: "12.34",
    whale_trade_count: 42,
    notes: "",
    source: "manual",
  };

  function createService(overrides?: {
    threshold?: string;
    dedupTtlMs?: string;
    isFollowed?: boolean;
    sendAlert?: boolean;
    marketRecord?: { question?: string; market_slug?: string } | null;
    stats?: SmartWalletStats | null;
    getStatsThrows?: boolean;
  }) {
    const sendAlert = vi.fn().mockResolvedValue(overrides?.sendAlert ?? true);
    const isFollowed = vi
      .fn<(address: string) => Promise<boolean>>()
      .mockResolvedValue(overrides?.isFollowed ?? true);
    const getStatsByAddress = vi
      .fn<(address: string) => Promise<SmartWalletStats | null>>()
      .mockImplementation(async (address: string) => {
        if (overrides?.getStatsThrows) {
          throw new Error("db unavailable");
        }
        if (overrides?.stats === null) {
          return null;
        }
        if (overrides?.stats !== undefined) {
          return { ...overrides.stats, address: overrides.stats.address || address };
        }
        return { ...defaultStats, address };
      });
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
      { getStatsByAddress } as unknown as SmartWalletsService,
      { isFollowed } as unknown as FollowedWalletsService,
      { sendAlert } as unknown as TelegramService,
    );

    return { service, isFollowed, getStatsByAddress, sendAlert, findByConditionId };
  }

  it("отправляет alert для followed-кошелька при сумме выше порога", async () => {
    const { service, isFollowed, sendAlert } = createService({
      threshold: "1000",
      isFollowed: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(true);

    expect(isFollowed).toHaveBeenCalledWith("0xmaker");
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("0xmaker"));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("1,500"));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringMatching(/HR/i));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringMatching(/ROI/i));
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining("42"));
  });

  it("не отправляет alert, если кошелёк НЕ followed", async () => {
    const { service, sendAlert, findByConditionId } = createService({
      threshold: "1000",
      isFollowed: false,
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

  it("не отправляет alert, если сумма ниже порога (followed не проверяется)", async () => {
    const { service, isFollowed, sendAlert } = createService({
      threshold: "1000",
      isFollowed: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "999",
      }),
    ).resolves.toBe(false);

    expect(isFollowed).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("отправляет alert при сумме ровно на пороге", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isFollowed: true,
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

  it("возвращает false, если TelegramService не смог отправить alert", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isFollowed: true,
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
      isFollowed: true,
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

  it("при ошибке getStatsByAddress отправляет алерт с HR n/a", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isFollowed: true,
      getStatsThrows: true,
    });

    await expect(
      service.maybeSendTradeAlert({
        address: "0xmaker",
        market: "0xmarket",
        side: "BUY",
        amount: "1500",
      }),
    ).resolves.toBe(true);

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith(expect.stringMatching(/HR:\s*n\/a/i));
  });

  it("не дублирует alert при повторном вызове с тем же tradeTimestamp в окне dedup", async () => {
    const { service, sendAlert } = createService({
      threshold: "1000",
      isFollowed: true,
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
