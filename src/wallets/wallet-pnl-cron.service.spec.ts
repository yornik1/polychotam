import { describe, expect, it, vi } from "vitest";
import type { SmartWalletStats } from "./smart-wallets.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";
import { QueueService } from "../queue/queue.service.js";
import { WalletPnlCronService } from "./wallet-pnl-cron.service.js";

function makeWallet(address: string): SmartWalletStats {
  return {
    address,
    active: true,
    hit_rate: null,
    sum_pnl: null,
    roi_pct: null,
    whale_trade_count: 0,
    notes: "",
    source: "test",
  };
}

function stubSmartWallets(addresses: string[]): SmartWalletsService {
  return {
    getActiveWhitelist: vi.fn().mockResolvedValue(addresses.map(makeWallet)),
  } as unknown as SmartWalletsService;
}

function stubQueueService(): { enqueueWalletPnlRecalc: ReturnType<typeof vi.fn>; instance: QueueService } {
  const enqueueWalletPnlRecalc = vi.fn().mockResolvedValue(undefined);
  return {
    enqueueWalletPnlRecalc,
    instance: { enqueueWalletPnlRecalc } as unknown as QueueService,
  };
}

describe("WalletPnlCronService", () => {
  it("ставит pnl-recalc job для каждого адреса из whitelist", async () => {
    const addresses = ["0xaaa", "0xbbb", "0xccc"];
    const smartWallets = stubSmartWallets(addresses);
    const { enqueueWalletPnlRecalc, instance: queueService } = stubQueueService();

    const cron = new WalletPnlCronService(smartWallets, queueService);
    await cron.enqueuePnlRecalcForWhitelistJob();

    expect(enqueueWalletPnlRecalc).toHaveBeenCalledTimes(3);
    expect(enqueueWalletPnlRecalc).toHaveBeenCalledWith("0xaaa");
    expect(enqueueWalletPnlRecalc).toHaveBeenCalledWith("0xbbb");
    expect(enqueueWalletPnlRecalc).toHaveBeenCalledWith("0xccc");
  });

  it("не падает при пустом whitelist", async () => {
    const smartWallets = stubSmartWallets([]);
    const { enqueueWalletPnlRecalc, instance: queueService } = stubQueueService();

    const cron = new WalletPnlCronService(smartWallets, queueService);
    await cron.enqueuePnlRecalcForWhitelistJob();

    expect(enqueueWalletPnlRecalc).not.toHaveBeenCalled();
  });

  it("перехватывает ошибку getActiveWhitelist без пробрасывания", async () => {
    const smartWallets = {
      getActiveWhitelist: vi.fn().mockRejectedValue(new Error("db down")),
    } as unknown as SmartWalletsService;
    const { enqueueWalletPnlRecalc, instance: queueService } = stubQueueService();

    const cron = new WalletPnlCronService(smartWallets, queueService);
    // Cron-метод не должен выбрасывать — ошибка логируется через logger.warn
    await expect(cron.enqueuePnlRecalcForWhitelistJob()).resolves.toBeUndefined();
    expect(enqueueWalletPnlRecalc).not.toHaveBeenCalled();
  });
});
