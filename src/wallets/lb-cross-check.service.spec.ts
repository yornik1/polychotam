import { describe, it, expect, vi } from "vitest";
import type { Repository } from "typeorm";
import { LbCrossCheckService } from "./lb-cross-check.service.js";
import type { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import type { DataApiClient } from "../polymarket/data-api.client.js";
import type { TelegramService } from "../telegram/telegram.service.js";
import type { ConfigService } from "@nestjs/config";
import type { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";

/** Строит минимальный снапшот для findOne-моков. */
function makeSnapshot(
  address: string,
  window: string,
  hypothesisTypes: string[] = [],
): WalletPnlSnapshot {
  return {
    address,
    window,
    pnl: "0",
    realized_pnl: "0",
    open_positions_value: "0",
    by_operation: {},
    hypothesis_types: hypothesisTypes,
    data_gaps: [],
    validated: false,
    last_watermark_ts: null,
    boundary_ids: [],
    computed_at: new Date(),
    internal_created_at: new Date(),
    internal_updated_at: new Date(),
  } as WalletPnlSnapshot;
}

/** Строит минимальный WalletPnlV2Summary. */
function makeSummary(address: string, window: string, totalPnl: number) {
  return {
    address,
    window,
    method: "cash_flow_wallet_activity" as const,
    realizedPnl: totalPnl,
    openPositionsValue: 0,
    totalPnl,
    byOperation: {},
    hypothesisTypes: [],
    dataGaps: [],
    validated: false,
    computedAt: new Date().toISOString(),
  };
}

function buildService({
  pnlResults,
  lbResults,
  snapshots = {},
  configValues = {},
  telegramService = null as TelegramService | null,
}: {
  pnlResults: Record<string, number>; // ключ: `${address}:${window}`
  lbResults: Record<string, number | null>; // ключ: `${address}:${window}`
  snapshots?: Record<string, WalletPnlSnapshot>;
  configValues?: Record<string, string>;
  telegramService?: TelegramService | null;
}): {
  service: LbCrossCheckService;
  snapshotRepo: { update: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn> };
  sendAdminAlert: ReturnType<typeof vi.fn>;
} {
  const sendAdminAlert = vi.fn().mockResolvedValue(true);

  const mockPnlV2 = {
    getOrComputePnl: vi.fn(async (address: string, window: string) => {
      const key = `${address}:${window}`;
      const val = pnlResults[key];
      if (val === undefined) throw new Error(`нет mock PnL для ${key}`);
      return makeSummary(address, window, val);
    }),
  } as unknown as WalletPnlV2Service;

  const mockDataApi = {
    fetchLbProfit: vi.fn(async (address: string, window: string) => {
      const key = `${address}:${window}`;
      const val = lbResults[key];
      if (val === undefined) throw new Error(`нет mock lb для ${key}`);
      if (val === null) return null;
      return { proxyWallet: address, amount: val };
    }),
  } as unknown as DataApiClient;

  const mockConfig = {
    get: vi.fn((key: string) => configValues[key] ?? undefined),
  } as unknown as ConfigService;

  const mockSnapshotRepo = {
    update: vi.fn().mockResolvedValue({}),
    findOne: vi.fn(async ({ where }: { where: { address: string; window: string } }) => {
      const key = `${where.address}:${where.window}`;
      return snapshots[key] ?? null;
    }),
  } as unknown as Repository<WalletPnlSnapshot>;

  const mockTelegram =
    telegramService !== null
      ? telegramService
      : ({
          sendAdminAlert,
        } as unknown as TelegramService);

  const service = new LbCrossCheckService(
    mockSnapshotRepo,
    mockPnlV2,
    mockDataApi,
    mockConfig,
    mockTelegram,
  );

  return {
    service,
    snapshotRepo: mockSnapshotRepo as unknown as {
      update: ReturnType<typeof vi.fn>;
      findOne: ReturnType<typeof vi.fn>;
    },
    sendAdminAlert,
  };
}

const ADDR = "0x2fb9a206";

describe("LbCrossCheckService.validateWallet", () => {
  describe("эмпирическая фикстура: pnl_v2=−8.34 lb=−7.66 (all) → pass", () => {
    it("validated=true, алерт не отправляется", async () => {
      const { service, snapshotRepo, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: -8.34,
          [`${ADDR}:30d`]: -8.34,
        },
        lbResults: {
          [`${ADDR}:all`]: -7.66,
          [`${ADDR}:30d`]: -7.66,
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: true });
      expect(sendAdminAlert).not.toHaveBeenCalled();
    });
  });

  describe("эмпирическая фикстура: diff −0.10 → pass", () => {
    it("validated=true без алертов", async () => {
      const { service, snapshotRepo, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: -7.56,
          [`${ADDR}:30d`]: -7.56,
        },
        lbResults: {
          [`${ADDR}:all`]: -7.66,
          [`${ADDR}:30d`]: -7.66,
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: true });
      expect(sendAdminAlert).not.toHaveBeenCalled();
    });
  });

  describe("эмпирическая фикстура: pnl_v2=+3.02 lb=+31.68 → fail", () => {
    it("validated=false, admin-алерт отправлен", async () => {
      const { service, snapshotRepo, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: 3.02,
          [`${ADDR}:30d`]: 3.02,
        },
        lbResults: {
          [`${ADDR}:all`]: 31.68,
          [`${ADDR}:30d`]: 31.68,
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: false });
      expect(sendAdminAlert).toHaveBeenCalled();
      const msg: string = sendAdminAlert.mock.calls[0]![0] as string;
      expect(msg).toContain("FAIL");
      expect(msg).toContain(ADDR);
    });
  });

  describe("diff 60 → investigate-алерт", () => {
    it("validated=false, алерт содержит INVESTIGATE", async () => {
      const { service, snapshotRepo, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: 160,
          [`${ADDR}:30d`]: 160,
        },
        lbResults: {
          [`${ADDR}:all`]: 100,
          [`${ADDR}:30d`]: 100,
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: false });
      expect(sendAdminAlert).toHaveBeenCalled();
      const msg: string = sendAdminAlert.mock.calls[0]![0] as string;
      expect(msg).toContain("INVESTIGATE");
    });
  });

  describe("lb null → validated=false без алерта", () => {
    it("нет алерта", async () => {
      const { service, snapshotRepo, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: -8.34,
        },
        lbResults: {
          [`${ADDR}:all`]: null,
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: false });
      expect(sendAdminAlert).not.toHaveBeenCalled();
    });

    it("all pass, но 30d отсутствует в лидерборде → validated=false (оба окна обязаны pass)", async () => {
      const { service, snapshotRepo, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: -8.34,
          [`${ADDR}:30d`]: -8.34,
        },
        lbResults: {
          [`${ADDR}:all`]: -7.66, // pass по ε
          [`${ADDR}:30d`]: null, // свежий кошелёк без 30d-записи в lb
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: false });
      expect(sendAdminAlert).not.toHaveBeenCalled();
    });
  });

  describe("hypothesisTypes в тексте алерта", () => {
    it("при fail алерт содержит упоминание hypothesis_types из снапшота", async () => {
      const snap = makeSnapshot(ADDR, "all", ["CONVERSION", "SPLIT"]);
      const { service, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: 3.02,
          [`${ADDR}:30d`]: 3.02,
        },
        lbResults: {
          [`${ADDR}:all`]: 31.68,
          [`${ADDR}:30d`]: 31.68,
        },
        snapshots: {
          [`${ADDR}:all`]: snap,
        },
      });

      await service.validateWallet(ADDR);

      expect(sendAdminAlert).toHaveBeenCalled();
      const msg: string = sendAdminAlert.mock.calls[0]![0] as string;
      expect(msg).toContain("CONVERSION");
      expect(msg).toContain("SPLIT");
    });

    it("при investigate алерт содержит hypothesis_types", async () => {
      const snap = makeSnapshot(ADDR, "all", ["MERGE"]);
      const { service, sendAdminAlert } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: 160,
          [`${ADDR}:30d`]: 160,
        },
        lbResults: {
          [`${ADDR}:all`]: 100,
          [`${ADDR}:30d`]: 100,
        },
        snapshots: {
          [`${ADDR}:all`]: snap,
        },
      });

      await service.validateWallet(ADDR);

      const msg: string = sendAdminAlert.mock.calls[0]![0] as string;
      expect(msg).toContain("MERGE");
    });
  });

  describe("одно окно fail, другое pass → validated=false", () => {
    it("fail на all → validated=false несмотря на pass на 30d", async () => {
      const { service, snapshotRepo } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: 3.02,
          [`${ADDR}:30d`]: -8.34,
        },
        lbResults: {
          [`${ADDR}:all`]: 31.68, // fail: diff=28.66
          [`${ADDR}:30d`]: -7.66, // pass: diff=0.68
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: false });
    });
  });

  describe("оба окна pass → validated=true", () => {
    it("validated=true", async () => {
      const { service, snapshotRepo } = buildService({
        pnlResults: {
          [`${ADDR}:all`]: -8.34,
          [`${ADDR}:30d`]: -8.34,
        },
        lbResults: {
          [`${ADDR}:all`]: -7.66,
          [`${ADDR}:30d`]: -7.66,
        },
      });

      await service.validateWallet(ADDR);

      expect(snapshotRepo.update).toHaveBeenCalledWith({ address: ADDR }, { validated: true });
    });
  });
});
