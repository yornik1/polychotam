import { describe, it, expect, vi } from "vitest";
import { Repository } from "typeorm";
import type { WalletActivityRaw, WalletPositionRaw } from "../types/contracts.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";
import { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import { DataApiClient } from "../polymarket/data-api.client.js";
import { ConfigService } from "@nestjs/config";

// ─── Хелперы фикстур ────────────────────────────────────────────────────────

function makeActivity(
  overrides: Partial<WalletActivityRaw> & { timestamp: number },
): WalletActivityRaw {
  return {
    proxyWallet: "0xabc",
    conditionId: "cond1",
    type: "TRADE",
    side: "BUY",
    size: 10,
    usdcSize: 5,
    transactionHash: `tx-${overrides.timestamp}`,
    asset: "asset1",
    outcomeIndex: 0,
    ...overrides,
  };
}

function makePosition(currentValue: number): WalletPositionRaw {
  return {
    proxyWallet: "0xabc",
    asset: "asset1",
    conditionId: "cond1",
    size: 1,
    avgPrice: 0.5,
    curPrice: 0.6,
    currentValue,
  };
}

function makeSnapshot(
  overrides: Partial<WalletPnlSnapshot> = {},
): WalletPnlSnapshot {
  const snap = new WalletPnlSnapshot();
  snap.address = "0xabc";
  snap.window = "all";
  snap.pnl = "0";
  snap.realized_pnl = "0";
  snap.open_positions_value = "0";
  snap.by_operation = {};
  snap.last_watermark_ts = null;
  snap.boundary_ids = [];
  snap.hypothesis_types = [];
  snap.data_gaps = [];
  snap.validated = false;
  snap.computed_at = new Date("2026-01-01T00:00:00.000Z");
  snap.internal_created_at = new Date("2026-01-01T00:00:00.000Z");
  snap.internal_updated_at = new Date("2026-01-01T00:00:00.000Z");
  return Object.assign(snap, overrides);
}

// ─── Фабрика сервиса ─────────────────────────────────────────────────────────

function createService(opts: {
  snapshotData?: WalletPnlSnapshot | null;
  activities?: WalletActivityRaw[];
  positions?: WalletPositionRaw[];
  ttlMs?: number;
}) {
  const snapshotData = opts.snapshotData ?? null;

  const snapshotFindOne = vi.fn().mockResolvedValue(snapshotData);
  const snapshotSave = vi.fn().mockImplementation(async (snap: WalletPnlSnapshot) => snap);
  const snapshotCreate = vi.fn().mockReturnValue(new WalletPnlSnapshot());

  const snapshotRepository = {
    findOne: snapshotFindOne,
    save: snapshotSave,
    create: snapshotCreate,
  } as unknown as Repository<WalletPnlSnapshot>;

  const fetchAllActivity = vi.fn().mockResolvedValue(opts.activities ?? []);
  const fetchPositions = vi.fn().mockResolvedValue(opts.positions ?? []);

  const dataApiClient = {
    fetchAllActivity,
    fetchPositions,
  } as unknown as DataApiClient;

  const configGet = vi.fn().mockReturnValue(
    opts.ttlMs !== undefined ? String(opts.ttlMs) : undefined,
  );
  const configService = { get: configGet } as unknown as ConfigService;

  const service = new WalletPnlV2Service(
    snapshotRepository,
    dataApiClient,
    configService,
  );

  return {
    service,
    snapshotFindOne,
    snapshotSave,
    snapshotCreate,
    fetchAllActivity,
    fetchPositions,
    configGet,
  };
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("WalletPnlV2Service", () => {
  describe("recalc(all) — полный синк без снапшота", () => {
    it("сохраняет снапшот после успешной загрузки", async () => {
      const activities = [
        makeActivity({ timestamp: 1000, type: "TRADE", side: "BUY", usdcSize: 10 }),
        makeActivity({ timestamp: 2000, type: "TRADE", side: "SELL", usdcSize: 15, transactionHash: "tx-2000" }),
      ];
      const positions = [makePosition(3)];

      const { service, snapshotSave, fetchAllActivity } = createService({ activities, positions });

      await service.recalc("0xabc", "all");

      expect(fetchAllActivity).toHaveBeenCalledWith("0xabc", {
        start: undefined,
        sortDirection: "ASC",
      });
      expect(snapshotSave).toHaveBeenCalledTimes(1);

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      // realized: -10 (BUY) + 15 (SELL) = 5; MTM = 3; total = 8
      expect(Number(saved.realized_pnl)).toBeCloseTo(5);
      expect(Number(saved.open_positions_value)).toBeCloseTo(3);
      expect(Number(saved.pnl)).toBeCloseTo(8);
      expect(saved.validated).toBe(false);
      expect(saved.last_watermark_ts).toBe("2000");
    });

    it("повторный recalc без новых записей не меняет агрегат", async () => {
      // Первый снапшот: watermark=2000, по нему уже посчитали
      const existingSnap = makeSnapshot({
        last_watermark_ts: "2000",
        realized_pnl: "5",
        pnl: "8",
        open_positions_value: "3",
        by_operation: { "TRADE:BUY": 10, "TRADE:SELL": 15 },
        boundary_ids: [{ transactionHash: "tx-2000|asset1|SELL|0|TRADE|15", timestamp: 2000 }],
      });

      // API возвращает только граничную запись (ts==watermark, та же identity)
      const boundaryActivity = makeActivity({
        timestamp: 2000,
        type: "TRADE",
        side: "SELL",
        usdcSize: 15,
        transactionHash: "tx-2000",
      });

      const { service, snapshotSave } = createService({
        snapshotData: existingSnap,
        activities: [boundaryActivity],
        positions: [makePosition(3)],
      });

      // После дедупа граничная запись удалена → newActivities = []
      // Realized delta = 0; накопленный realized остаётся 5
      await service.recalc("0xabc", "all");

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      // prevRealized=5 + delta=0 = 5; MTM=3; total=8
      expect(Number(saved.realized_pnl)).toBeCloseTo(5);
      expect(Number(saved.pnl)).toBeCloseTo(8);
    });
  });

  describe("recalc(all) — граничный дедуп", () => {
    it("два окна с перекрытием: запись на watermark не дублируется, новая идентичная не теряется", async () => {
      // Граница: ts=1000, в boundary_ids — одна запись с identity A
      // API возвращает: 2 записи с ts=1000 (одна — та же identity A, вторая — новая идентичная)
      // Ожидаем: удалить одну A (boundary), вторую A оставить как новую легитимную
      const idA = "tx-1000|asset1|BUY|0|TRADE|20"; // identity первой
      const existingSnap = makeSnapshot({
        last_watermark_ts: "1000",
        realized_pnl: "-20",
        pnl: "-20",
        open_positions_value: "0",
        by_operation: { "TRADE:BUY": 20 },
        boundary_ids: [{ transactionHash: idA, timestamp: 1000 }],
      });

      // Обе записи идентичны: ts=1000, BUY, usdcSize=20
      const act1 = makeActivity({ timestamp: 1000, type: "TRADE", side: "BUY", usdcSize: 20, transactionHash: "tx-1000" });
      const act2 = makeActivity({ timestamp: 1000, type: "TRADE", side: "BUY", usdcSize: 20, transactionHash: "tx-1000" });

      const { service, snapshotSave } = createService({
        snapshotData: existingSnap,
        activities: [act1, act2],
        positions: [],
      });

      await service.recalc("0xabc", "all");

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      // Дедуп удаляет одну из двух → остаётся 1 новая BUY -20
      // prevRealized = -20; delta = -20; итого = -40
      expect(Number(saved.realized_pnl)).toBeCloseTo(-40);
    });

    it("легитимные идентичные операции внутри окна (ts > watermark) не съедаются", async () => {
      const existingSnap = makeSnapshot({
        last_watermark_ts: "1000",
        realized_pnl: "0",
        pnl: "0",
        open_positions_value: "0",
        by_operation: {},
        boundary_ids: [],
      });

      // Три одинаковые BUY на ts=2000 (внутри окна, не на границе)
      const act = () => makeActivity({ timestamp: 2000, type: "TRADE", side: "BUY", usdcSize: 10, transactionHash: "tx-2000" });

      const { service, snapshotSave } = createService({
        snapshotData: existingSnap,
        activities: [act(), act(), act()],
        positions: [],
      });

      await service.recalc("0xabc", "all");

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      // Все три записи на ts>watermark не дедупятся: delta = -30
      // prevRealized=0; итого = -30
      expect(Number(saved.realized_pnl)).toBeCloseTo(-30);
    });
  });

  describe("getOrComputePnl — TTL", () => {
    it("свежий снапшот (в пределах TTL) не дёргает API", async () => {
      const freshSnap = makeSnapshot({
        computed_at: new Date(Date.now() - 1000), // 1 секунда назад
        realized_pnl: "42",
        pnl: "42",
        open_positions_value: "0",
      });

      const { service, fetchAllActivity, fetchPositions } = createService({
        snapshotData: freshSnap,
        ttlMs: 10_000, // TTL = 10 секунд
      });

      const result = await service.getOrComputePnl("0xabc", "all");

      expect(fetchAllActivity).not.toHaveBeenCalled();
      expect(fetchPositions).not.toHaveBeenCalled();
      expect(result.realizedPnl).toBeCloseTo(42);
    });

    it("устаревший снапшот (TTL истёк) запускает recalc", async () => {
      const staleSnap = makeSnapshot({
        computed_at: new Date(Date.now() - 20_000), // 20 секунд назад
        realized_pnl: "42",
        pnl: "42",
        open_positions_value: "0",
      });

      // После recalc findOne вернёт обновлённый снапшот
      const updatedSnap = makeSnapshot({
        computed_at: new Date(),
        realized_pnl: "55",
        pnl: "55",
        open_positions_value: "0",
      });

      const snapshotFindOne = vi.fn()
        .mockResolvedValueOnce(staleSnap) // первый вызов — устаревший
        .mockResolvedValueOnce(null)       // внутри recalcAll (existing)
        .mockResolvedValueOnce(updatedSnap); // финальный вызов в getOrComputePnl

      const snapshotSave = vi.fn().mockImplementation(async (s: WalletPnlSnapshot) => s);
      const snapshotCreate = vi.fn().mockReturnValue(new WalletPnlSnapshot());

      const snapshotRepository = {
        findOne: snapshotFindOne,
        save: snapshotSave,
        create: snapshotCreate,
      } as unknown as Repository<WalletPnlSnapshot>;

      const fetchAllActivity = vi.fn().mockResolvedValue([]);
      const fetchPositions = vi.fn().mockResolvedValue([]);
      const dataApiClient = { fetchAllActivity, fetchPositions } as unknown as DataApiClient;
      const configService = { get: vi.fn().mockReturnValue("10000") } as unknown as ConfigService;

      const service = new WalletPnlV2Service(snapshotRepository, dataApiClient, configService);

      const result = await service.getOrComputePnl("0xabc", "all");

      expect(fetchAllActivity).toHaveBeenCalledTimes(1);
      expect(result.realizedPnl).toBeCloseTo(55);
    });
  });

  describe("ошибка страницы — throw, снапшот не сохранён", () => {
    it("ошибка fetchAllActivity — throw, snapshotSave не вызван", async () => {
      const snapshotSave = vi.fn();
      const snapshotFindOne = vi.fn().mockResolvedValue(null);
      const snapshotCreate = vi.fn().mockReturnValue(new WalletPnlSnapshot());
      const snapshotRepository = {
        findOne: snapshotFindOne,
        save: snapshotSave,
        create: snapshotCreate,
      } as unknown as Repository<WalletPnlSnapshot>;

      const fetchAllActivity = vi.fn().mockRejectedValue(new Error("upstream error"));
      const fetchPositions = vi.fn().mockResolvedValue([]);
      const dataApiClient = { fetchAllActivity, fetchPositions } as unknown as DataApiClient;
      const configService = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

      const service = new WalletPnlV2Service(snapshotRepository, dataApiClient, configService);

      await expect(service.recalc("0xabc", "all")).rejects.toThrow("upstream error");
      expect(snapshotSave).not.toHaveBeenCalled();
    });

    it("ошибка fetchPositions — throw, snapshotSave не вызван", async () => {
      const snapshotSave = vi.fn();
      const snapshotFindOne = vi.fn().mockResolvedValue(null);
      const snapshotCreate = vi.fn().mockReturnValue(new WalletPnlSnapshot());
      const snapshotRepository = {
        findOne: snapshotFindOne,
        save: snapshotSave,
        create: snapshotCreate,
      } as unknown as Repository<WalletPnlSnapshot>;

      const fetchAllActivity = vi.fn().mockResolvedValue([
        makeActivity({ timestamp: 1000 }),
      ]);
      const fetchPositions = vi.fn().mockRejectedValue(new Error("positions error"));
      const dataApiClient = { fetchAllActivity, fetchPositions } as unknown as DataApiClient;
      const configService = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

      const service = new WalletPnlV2Service(snapshotRepository, dataApiClient, configService);

      await expect(service.recalc("0xabc", "all")).rejects.toThrow("positions error");
      expect(snapshotSave).not.toHaveBeenCalled();
    });
  });

  describe("многостраничный кит — 3 страницы агрегируются корректно", () => {
    it("сумма всех страниц корректно накапливается", async () => {
      // Симулируем данные, которые DataApiClient уже собрал за 3 страницы
      // (fetchAllActivity — готовый массив, пагинация внутри клиента)
      const activities: WalletActivityRaw[] = [];
      for (let i = 1; i <= 3; i++) {
        // Каждая «страница» = 500 записей, но здесь мы тестируем агрегацию, а не пагинацию
        activities.push(
          makeActivity({ timestamp: i * 1000, type: "TRADE", side: "BUY", usdcSize: 100, transactionHash: `tx-buy-${i}` }),
          makeActivity({ timestamp: i * 1000 + 1, type: "TRADE", side: "SELL", usdcSize: 150, transactionHash: `tx-sell-${i}` }),
        );
      }
      // 3 BUY × 100 = 300; 3 SELL × 150 = 450; realized = 150; MTM = 0
      const { service, snapshotSave } = createService({
        activities,
        positions: [],
      });

      await service.recalc("0xabc", "all");

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      expect(Number(saved.realized_pnl)).toBeCloseTo(150);
      expect(Number(saved.pnl)).toBeCloseTo(150);
      expect(saved.by_operation["TRADE:BUY"]).toBeCloseTo(300);
      expect(saved.by_operation["TRADE:SELL"]).toBeCloseTo(450);
    });
  });

  describe("recalc(30d) — полный пересчёт скользящего окна", () => {
    it("start передаётся как now−30d (в секундах)", async () => {
      const nowMs = 1_748_000_000_000; // фиксированный now
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs);

      const { service, fetchAllActivity, snapshotSave } = createService({
        activities: [],
        positions: [],
      });

      await service.recalc("0xabc", "30d");

      const expectedStart = Math.floor(nowMs / 1000) - 30 * 86400;
      expect(fetchAllActivity).toHaveBeenCalledWith("0xabc", {
        start: expectedStart,
        sortDirection: "ASC",
      });
      expect(snapshotSave).toHaveBeenCalledTimes(1);

      dateSpy.mockRestore();
    });

    it("window=30d: пересчёт полностью заменяет предыдущий агрегат", async () => {
      const existingSnap = makeSnapshot({
        window: "30d",
        realized_pnl: "999",
        pnl: "999",
        by_operation: { "TRADE:SELL": 999 },
        last_watermark_ts: "500",
      });

      // Снапшот window=30d уже есть в БД
      const snapshotFindOne = vi.fn()
        .mockResolvedValueOnce(null)   // для recalcWindow: existing
        .mockResolvedValueOnce(existingSnap); // не используется здесь, но для completeness

      const snapshotSave = vi.fn().mockImplementation(async (s: WalletPnlSnapshot) => s);
      const snapshotCreate = vi.fn().mockReturnValue(new WalletPnlSnapshot());

      const snapshotRepository = {
        findOne: snapshotFindOne,
        save: snapshotSave,
        create: snapshotCreate,
      } as unknown as Repository<WalletPnlSnapshot>;

      const activities = [
        makeActivity({ timestamp: 2000, type: "TRADE", side: "SELL", usdcSize: 30, transactionHash: "tx-new" }),
      ];
      const fetchAllActivity = vi.fn().mockResolvedValue(activities);
      const fetchPositions = vi.fn().mockResolvedValue([]);
      const dataApiClient = { fetchAllActivity, fetchPositions } as unknown as DataApiClient;
      const configService = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

      const service = new WalletPnlV2Service(snapshotRepository, dataApiClient, configService);

      await service.recalc("0xabc", "30d");

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      // Полный пересчёт: только новые 30 USDC (SELL), не 999
      expect(Number(saved.realized_pnl)).toBeCloseTo(30);
      expect(saved.by_operation["TRADE:SELL"]).toBeCloseTo(30);
      expect(saved.window).toBe("30d");
    });
  });

  describe("recalc(90d) — start = now − 90d", () => {
    it("start передаётся как now−90d", async () => {
      const nowMs = 1_748_000_000_000;
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(nowMs);

      const { service, fetchAllActivity } = createService({
        activities: [],
        positions: [],
      });

      await service.recalc("0xabc", "90d");

      const expectedStart = Math.floor(nowMs / 1000) - 90 * 86400;
      expect(fetchAllActivity).toHaveBeenCalledWith("0xabc", {
        start: expectedStart,
        sortDirection: "ASC",
      });

      dateSpy.mockRestore();
    });
  });

  describe("incremental — накопление byOperation между синками", () => {
    it("второй синк с новыми записями добавляет вклад к предыдущему агрегату", async () => {
      const existingSnap = makeSnapshot({
        last_watermark_ts: "1000",
        realized_pnl: "10",
        pnl: "13",
        open_positions_value: "3",
        by_operation: { "TRADE:SELL": 10 },
        boundary_ids: [{ transactionHash: "tx-1000|asset1||0|TRADE:SELL|10", timestamp: 1000 }],
      });

      // Новая запись на ts=2000 (после watermark, нет дедупа)
      const newActivity = makeActivity({
        timestamp: 2000,
        type: "TRADE",
        side: "SELL",
        usdcSize: 20,
        transactionHash: "tx-2000",
      });

      const { service, snapshotSave } = createService({
        snapshotData: existingSnap,
        activities: [newActivity],
        positions: [makePosition(5)],
      });

      await service.recalc("0xabc", "all");

      const saved = snapshotSave.mock.calls[0]![0] as WalletPnlSnapshot;
      // prevRealized=10 + delta=20 = 30; MTM=5; total=35
      expect(Number(saved.realized_pnl)).toBeCloseTo(30);
      expect(Number(saved.open_positions_value)).toBeCloseTo(5);
      expect(Number(saved.pnl)).toBeCloseTo(35);
      // byOperation накопился
      expect(saved.by_operation["TRADE:SELL"]).toBeCloseTo(30);
    });
  });
});
