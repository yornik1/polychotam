import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Repository } from "typeorm";
import { WsConnectionEvent } from "./ws-connection-event.entity.js";
import { WsUptimeService } from "./ws-uptime.service.js";

describe("WsUptimeService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("только текущая open-сессия c событиями в окне даёт ratio от момента connect", async () => {
    const openAt = new Date("2026-01-01T12:00:00.000Z");
    vi.setSystemTime(openAt);

    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn().mockResolvedValue(null);
    const find = vi.fn();

    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;
    const service = new WsUptimeService(repo);

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
    const windowMs = 24 * 60 * 60 * 1000;
    expect(ratio).toBeCloseTo((6 * 60 * 60 * 1000) / windowMs, 5);
    expect(service.getElapsedMs()).toBe(6 * 60 * 60 * 1000);
  });

  it("история open/close в окне 24h суммируется с последующей open-сессией", async () => {
    const windowEnd = new Date("2026-01-02T12:00:00.000Z");
    vi.setSystemTime(windowEnd);

    const save = vi.fn((e: WsConnectionEvent) => Promise.resolve(e));
    const findOne = vi.fn().mockResolvedValue(null);

    const histOpen = new Date("2026-01-01T14:00:00.000Z");
    const histClose = new Date("2026-01-01T16:00:00.000Z");
    const lastOpen = new Date("2026-01-02T10:00:00.000Z");

    const find = vi.fn().mockResolvedValue([
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

    const repo = { save, findOne, find } as unknown as Repository<WsConnectionEvent>;
    const service = new WsUptimeService(repo);

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
    const windowMs = 24 * 60 * 60 * 1000;
    const upHist = histClose.getTime() - histOpen.getTime();
    const upLast = windowEnd.getTime() - lastOpen.getTime();
    expect(ratio).toBeCloseTo((upHist + upLast) / windowMs, 5);
  });
});
