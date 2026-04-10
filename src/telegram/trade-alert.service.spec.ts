import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { WalletsService } from "../wallets/wallets.service.js";
import { TelegramService } from "./telegram.service.js";
import { TradeAlertService } from "./trade-alert.service.js";

describe("TradeAlertService", () => {
  function createService(overrides?: { threshold?: string; isTopWallet?: boolean; sendAlert?: boolean }) {
    const sendAlert = vi.fn().mockResolvedValue(overrides?.sendAlert ?? true);
    const isTopWallet = vi
      .fn<(address: string) => Promise<boolean>>()
      .mockResolvedValue(overrides?.isTopWallet ?? true);
    const get = vi.fn((key: string) => {
      if (key === "ALERT_THRESHOLD_AMOUNT") {
        return overrides?.threshold;
      }

      return undefined;
    });

    const service = new TradeAlertService(
      { get } as unknown as ConfigService,
      { isTopWallet } as unknown as WalletsService,
      { sendAlert } as unknown as TelegramService,
    );

    return { service, isTopWallet, sendAlert };
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
});
