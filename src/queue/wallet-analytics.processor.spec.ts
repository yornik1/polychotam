import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { WalletRecalculateJob } from "../types/contracts.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { WALLET_ANALYTICS_JOB_RECALCULATE } from "./trades-queue.config.js";
import { WalletAnalyticsProcessor } from "./wallet-analytics.processor.js";

function jobStub(
  name: string,
  data: WalletRecalculateJob,
): Pick<Job<WalletRecalculateJob>, "name" | "data"> {
  return { name, data };
}

describe("WalletAnalyticsProcessor", () => {
  it("вызывает walletsService.recalculate для job пересчёта", async () => {
    const recalculate = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate } as unknown as WalletsService,
    );

    await processor.process(
      jobStub(WALLET_ANALYTICS_JOB_RECALCULATE, { address: "0xabc" }) as Job<WalletRecalculateJob>,
    );

    expect(recalculate).toHaveBeenCalledWith("0xabc");
  });

  it("игнорирует чужие job names", async () => {
    const recalculate = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate } as unknown as WalletsService,
    );

    await processor.process(
      jobStub("other", { address: "0xabc" }) as Job<WalletRecalculateJob>,
    );

    expect(recalculate).not.toHaveBeenCalled();
  });
});
