import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { SmartScoreRecalcJob, WalletPnlRecalcJob, WalletRecalculateJob } from "../types/contracts.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { WalletPnlV2Service } from "../wallets/wallet-pnl-v2.service.js";
import { LbCrossCheckService } from "../wallets/lb-cross-check.service.js";
import { WalletScoreService } from "../wallets/wallet-score.service.js";
import { BullJobNdjsonLogService } from "./bull-job-ndjson-log.service.js";
import {
  WALLET_ANALYTICS_JOB_PNL_RECALC,
  WALLET_ANALYTICS_JOB_RECALCULATE,
} from "./trades-queue.config.js";
import { WALLET_ANALYTICS_JOB_SMART_SCORE_RECALC } from "../wallets/wallet-score-cron.service.js";
import { WalletAnalyticsProcessor } from "./wallet-analytics.processor.js";

function jobStub<T>(name: string, data: T): Pick<Job<T>, "name" | "data"> {
  return { name, data };
}

function stubNdjson(): BullJobNdjsonLogService {
  return {
    append: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(false),
    getAbsolutePath: vi.fn().mockReturnValue(null),
    logWorkerFailed: vi.fn(),
  } as unknown as BullJobNdjsonLogService;
}

function stubPnlV2Service(recalc = vi.fn().mockResolvedValue(undefined)): WalletPnlV2Service {
  return { recalc } as unknown as WalletPnlV2Service;
}

function stubScoreService(recalcScores = vi.fn().mockResolvedValue(undefined)): WalletScoreService {
  return { recalcScores } as unknown as WalletScoreService;
}

function stubLbCrossCheck(validateWallet = vi.fn().mockResolvedValue(undefined)): LbCrossCheckService {
  return { validateWallet } as unknown as LbCrossCheckService;
}

describe("WalletAnalyticsProcessor", () => {
  it("вызывает walletsService.recalculate для job wallet-recalculate", async () => {
    const recalculate = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate } as unknown as WalletsService,
      stubPnlV2Service(),
      stubLbCrossCheck(),
      stubScoreService(),
      stubNdjson(),
    );

    await processor.process(
      jobStub(WALLET_ANALYTICS_JOB_RECALCULATE, { address: "0xabc" }) as Job<WalletRecalculateJob>,
    );

    expect(recalculate).toHaveBeenCalledWith("0xabc");
  });

  it("не вызывает recalculate при job wallet-pnl-recalc", async () => {
    const recalculate = vi.fn().mockResolvedValue(undefined);
    const recalc = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate } as unknown as WalletsService,
      stubPnlV2Service(recalc),
      stubLbCrossCheck(),
      stubScoreService(),
      stubNdjson(),
    );

    await processor.process(
      jobStub(WALLET_ANALYTICS_JOB_PNL_RECALC, { address: "0xabc" }) as Job<WalletPnlRecalcJob>,
    );

    expect(recalculate).not.toHaveBeenCalled();
  });

  it("вызывает recalc для трёх окон при job wallet-pnl-recalc", async () => {
    const recalc = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate: vi.fn() } as unknown as WalletsService,
      stubPnlV2Service(recalc),
      stubLbCrossCheck(),
      stubScoreService(),
      stubNdjson(),
    );

    await processor.process(
      jobStub(WALLET_ANALYTICS_JOB_PNL_RECALC, { address: "0xdef" }) as Job<WalletPnlRecalcJob>,
    );

    expect(recalc).toHaveBeenCalledTimes(3);
    expect(recalc).toHaveBeenNthCalledWith(1, "0xdef", "all");
    expect(recalc).toHaveBeenNthCalledWith(2, "0xdef", "90d");
    expect(recalc).toHaveBeenNthCalledWith(3, "0xdef", "30d");
  });

  it("после пересчёта PnL вызывает кросс-валидацию validateWallet", async () => {
    const calls: string[] = [];
    const recalc = vi.fn().mockImplementation(async () => {
      calls.push("recalc");
    });
    const validateWallet = vi.fn().mockImplementation(async () => {
      calls.push("validate");
    });
    const processor = new WalletAnalyticsProcessor(
      { recalculate: vi.fn() } as unknown as WalletsService,
      stubPnlV2Service(recalc),
      stubLbCrossCheck(validateWallet),
      stubScoreService(),
      stubNdjson(),
    );

    await processor.process(
      jobStub(WALLET_ANALYTICS_JOB_PNL_RECALC, { address: "0xdef" }) as Job<WalletPnlRecalcJob>,
    );

    expect(validateWallet).toHaveBeenCalledWith("0xdef");
    // валидация строго после всех трёх окон пересчёта
    expect(calls).toEqual(["recalc", "recalc", "recalc", "validate"]);
  });

  it("ошибка recalc пробрасывается наружу (не глотается)", async () => {
    const boom = new Error("network fail");
    const recalc = vi.fn().mockRejectedValue(boom);
    const processor = new WalletAnalyticsProcessor(
      { recalculate: vi.fn() } as unknown as WalletsService,
      stubPnlV2Service(recalc),
      stubLbCrossCheck(),
      stubScoreService(),
      stubNdjson(),
    );

    await expect(
      processor.process(
        jobStub(WALLET_ANALYTICS_JOB_PNL_RECALC, { address: "0xfail" }) as Job<WalletPnlRecalcJob>,
      ),
    ).rejects.toThrow("network fail");
  });

  it("игнорирует полностью неизвестные job names", async () => {
    const recalculate = vi.fn().mockResolvedValue(undefined);
    const recalc = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate } as unknown as WalletsService,
      stubPnlV2Service(recalc),
      stubLbCrossCheck(),
      stubScoreService(),
      stubNdjson(),
    );

    await processor.process(
      jobStub("other", { address: "0xabc" }) as Job<WalletRecalculateJob>,
    );

    expect(recalculate).not.toHaveBeenCalled();
    expect(recalc).not.toHaveBeenCalled();
  });

  it("вызывает walletScoreService.recalcScores для job smart-score-recalc", async () => {
    const recalcScores = vi.fn().mockResolvedValue(undefined);
    const processor = new WalletAnalyticsProcessor(
      { recalculate: vi.fn() } as unknown as WalletsService,
      stubPnlV2Service(),
      stubLbCrossCheck(),
      stubScoreService(recalcScores),
      stubNdjson(),
    );

    await processor.process(
      jobStub(WALLET_ANALYTICS_JOB_SMART_SCORE_RECALC, {}) as Job<SmartScoreRecalcJob>,
    );

    expect(recalcScores).toHaveBeenCalledOnce();
  });
});
