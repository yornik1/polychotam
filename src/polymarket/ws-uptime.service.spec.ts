import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Repository } from "typeorm";
import { WsConnectionEvent } from "./ws-connection-event.entity.js";
import { WsUptimeService } from "./ws-uptime.service.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Запрос последнего события до левой границы окна (есть `where`). */
function isLastBeforeWindowQuery(opts: unknown): boolean {
  return (
    typeof opts === "object" &&
    opts !== null &&
    "where" in opts &&
    (opts as { where?: unknown }).where !== undefined
  );
}

function attachRepositoryReadsForInit(
  findOne: ReturnType<typeof vi.fn>,
  find: ReturnType<typeof vi.fn>,
  lastBeforeResult: WsConnectionEvent | null,
  latestResult: WsConnectionEvent | null = null,
): void {
  findOne.mockImplementation((opts?: { where?: unknown }) => {
    if (isLastBeforeWindowQuery(opts)) {
      return Promise.resolve(lastBeforeResult);
    }
    return Promise.resolve(null);
  });
  find.mockResolvedValueOnce(latestResult === null ? [] : [latestResult]);
}

describe("WsUptimeService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("после краша: последнее в БД open → onModuleInit дописывает close", async () => {
    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn();
    const find = vi.fn();
    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;

    const danglingOpenAt = new Date("2026-01-10T10:00:00.000Z");
    const recoveryAt = new Date("2026-01-10T20:00:00.000Z");
    vi.setSystemTime(recoveryAt);

    attachRepositoryReadsForInit(
      findOne,
      find,
      null,
      Object.assign(new WsConnectionEvent(), {
        id: "1",
        kind: "open" as const,
        at: danglingOpenAt,
      }),
    );

    const service = new WsUptimeService(repo);
    await service.onModuleInit();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "close", at: recoveryAt }),
    );
  });

  it("onModuleInit не пишет close, если последнее событие — close", async () => {
    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn();
    const find = vi.fn();
    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;

    attachRepositoryReadsForInit(
      findOne,
      find,
      null,
      Object.assign(new WsConnectionEvent(), {
        id: "1",
        kind: "close" as const,
        at: new Date("2026-01-10T10:00:00.000Z"),
      }),
    );

    const service = new WsUptimeService(repo);
    await service.onModuleInit();
    expect(save).not.toHaveBeenCalled();
  });

  it("после recovery ratio 24h не считает даунтайм после open как аптаим", async () => {
    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn();
    const find = vi.fn();
    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;

    const crashOpen = new Date("2026-01-01T00:00:00.000Z");
    const recoveryTime = new Date("2026-01-01T12:00:00.000Z");
    const newSessionOpen = new Date("2026-01-01T14:00:00.000Z");
    const windowEnd = new Date("2026-01-02T12:00:00.000Z");

    vi.setSystemTime(recoveryTime);
    attachRepositoryReadsForInit(
      findOne,
      find,
      null,
      Object.assign(new WsConnectionEvent(), { kind: "open" as const, at: crashOpen }),
    );

    const service = new WsUptimeService(repo);
    await service.onModuleInit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: "close", at: recoveryTime }));

    findOne.mockImplementation((opts?: { where?: unknown }) => {
      if (isLastBeforeWindowQuery(opts)) {
        return Promise.resolve(
          Object.assign(new WsConnectionEvent(), { kind: "open" as const, at: crashOpen }),
        );
      }
      return Promise.resolve(null);
    });

    vi.setSystemTime(newSessionOpen);
    await service.markOpen();

    vi.setSystemTime(windowEnd);
    const syntheticClose = recoveryTime.getTime();
    const inWindow = [
      Object.assign(new WsConnectionEvent(), {
        kind: "close" as const,
        at: new Date(syntheticClose),
      }),
      Object.assign(new WsConnectionEvent(), { kind: "open" as const, at: newSessionOpen }),
    ];
    find.mockReset();
    find.mockResolvedValue(inWindow);

    const ratio = await service.getUptimeRatio24h();
    const upMs = windowEnd.getTime() - newSessionOpen.getTime();
    expect(ratio).toBeCloseTo(upMs / WINDOW_MS, 5);
  });

  it("getUptimeRatio24h: lastBefore open — up от начала окна до первого close в окне", async () => {
    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn();
    const find = vi.fn();
    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;

    const windowEnd = new Date("2026-01-02T12:00:00.000Z");
    vi.setSystemTime(windowEnd);

    const lastBeforeOpenAt = new Date("2026-01-01T06:00:00.000Z");
    const closeInWindow = new Date("2026-01-01T18:00:00.000Z");

    attachRepositoryReadsForInit(
      findOne,
      find,
      Object.assign(new WsConnectionEvent(), {
        kind: "open" as const,
        at: lastBeforeOpenAt,
      }),
    );

    const service = new WsUptimeService(repo);
    await service.onModuleInit();

    find.mockResolvedValueOnce([
      Object.assign(new WsConnectionEvent(), { kind: "close" as const, at: closeInWindow }),
    ]);

    const ratio = await service.getUptimeRatio24h();
    const windowStart = windowEnd.getTime() - WINDOW_MS;
    const upMs = closeInWindow.getTime() - windowStart;
    expect(ratio).toBeCloseTo(upMs / WINDOW_MS, 5);
  });

  it("только текущая open-сессия c событиями в окне даёт ratio от момента connect", async () => {
    const openAt = new Date("2026-01-01T12:00:00.000Z");
    vi.setSystemTime(openAt);

    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn();
    const find = vi.fn();

    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;
    attachRepositoryReadsForInit(findOne, find, null);
    const service = new WsUptimeService(repo);
    await service.onModuleInit();

    await service.markOpen();

    const now = new Date(openAt.getTime() + 6 * 60 * 60 * 1000);
    vi.setSystemTime(now);
    find.mockResolvedValueOnce([
      Object.assign(new WsConnectionEvent(), {
        id: "1",
        kind: "open" as const,
        at: openAt,
      }),
    ]);

    const ratio = await service.getUptimeRatio24h();
    expect(ratio).toBeCloseTo((6 * 60 * 60 * 1000) / WINDOW_MS, 5);
    expect(service.getElapsedMs()).toBe(6 * 60 * 60 * 1000);
  });

  it("история open/close в окне 24h суммируется с последующей open-сессией", async () => {
    const windowEnd = new Date("2026-01-02T12:00:00.000Z");
    vi.setSystemTime(windowEnd);

    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn();
    const find = vi.fn();

    const histOpen = new Date("2026-01-01T14:00:00.000Z");
    const histClose = new Date("2026-01-01T16:00:00.000Z");
    const lastOpen = new Date("2026-01-02T10:00:00.000Z");

    attachRepositoryReadsForInit(findOne, find, null);
    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;
    const service = new WsUptimeService(repo);
    await service.onModuleInit();

    vi.setSystemTime(lastOpen);
    await service.markOpen();
    vi.setSystemTime(windowEnd);

    find.mockResolvedValueOnce([
      Object.assign(new WsConnectionEvent(), {
        id: "1",
        kind: "open" as const,
        at: histOpen,
      }),
      Object.assign(new WsConnectionEvent(), {
        id: "2",
        kind: "close" as const,
        at: histClose,
      }),
      Object.assign(new WsConnectionEvent(), {
        id: "3",
        kind: "open" as const,
        at: lastOpen,
      }),
    ]);

    const ratio = await service.getUptimeRatio24h();
    const upHist = histClose.getTime() - histOpen.getTime();
    const upLast = windowEnd.getTime() - lastOpen.getTime();
    expect(ratio).toBeCloseTo((upHist + upLast) / WINDOW_MS, 5);
  });
});
