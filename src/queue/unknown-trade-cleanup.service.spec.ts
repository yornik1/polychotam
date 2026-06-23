import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Trade } from "../trades/trade.entity.js";
import { UnknownTradeCleanupService } from "./unknown-trade-cleanup.service.js";

describe("UnknownTradeCleanupService", () => {
  const execute = vi.fn();
  const where = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const del = vi.fn().mockReturnThis();
  const createQueryBuilder = vi.fn(() => ({ delete: del, from, where, execute }));
  const config = new Map<string, string>();

  async function build(): Promise<UnknownTradeCleanupService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UnknownTradeCleanupService,
        {
          provide: getRepositoryToken(Trade),
          useValue: { createQueryBuilder },
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config.get(key) },
        },
      ],
    }).compile();
    return moduleRef.get(UnknownTradeCleanupService);
  }

  beforeEach(() => {
    execute.mockReset();
    where.mockClear();
    del.mockClear();
    from.mockClear();
    createQueryBuilder.mockClear();
    config.clear();
    config.set("TRADE_UNKNOWN_CLEANUP_ENABLED", "true");
  });

  it("по умолчанию выключен — ничего не удаляет", async () => {
    config.delete("TRADE_UNKNOWN_CLEANUP_ENABLED");
    const service = await build();

    const result = await service.cleanupBatch();

    expect(result.skipped).toBe("disabled");
    expect(result.deleted).toBe(0);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it("удаляет батчами, пока хвост не дренирован", async () => {
    config.set("TRADE_UNKNOWN_CLEANUP_BATCH_SIZE", "5000");
    execute
      .mockResolvedValueOnce({ affected: 5000 })
      .mockResolvedValueOnce({ affected: 1200 });
    const service = await build();

    const result = await service.cleanupBatch();

    // Батч < BATCH_SIZE — сигнал дренажа: лишний пустой round-trip не делаем.
    expect(result.deleted).toBe(6200);
    expect(result.batches).toBe(2);
    expect(result.drained).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("упирается в потолок батчей за тик и не дренирует за раз", async () => {
    config.set("TRADE_UNKNOWN_CLEANUP_BATCH_SIZE", "5000");
    config.set("TRADE_UNKNOWN_CLEANUP_MAX_BATCHES", "1");
    execute.mockResolvedValue({ affected: 5000 });
    const service = await build();

    const result = await service.cleanupBatch();

    expect(result.deleted).toBe(5000);
    expect(result.batches).toBe(1);
    expect(result.drained).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("дренирован сразу, если удалять нечего", async () => {
    execute.mockResolvedValue({ affected: 0 });
    const service = await build();

    const result = await service.cleanupBatch();

    expect(result.deleted).toBe(0);
    expect(result.drained).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
