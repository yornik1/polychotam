import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Repository } from "typeorm";
import { AlertSettingsService } from "./alert-settings.service.js";
import { AppSetting } from "./app-setting.entity.js";

describe("AlertSettingsService", () => {
  const KEY = "alerts_enabled";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService(repoOverrides?: { findOne?: unknown }) {
    const findOne = vi.fn().mockResolvedValue(repoOverrides?.findOne ?? { value: "true" });
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = { findOne, upsert } as unknown as Repository<AppSetting>;
    const service = new AlertSettingsService(repository);
    return { service, repository, findOne };
  }

  it("isAlertsEnabled читает значение из БД и кэширует на 30s", async () => {
    const { service, repository, findOne } = createService({
      findOne: { key: KEY, value: "false" },
    });

    await expect(service.isAlertsEnabled()).resolves.toBe(false);
    await expect(service.isAlertsEnabled()).resolves.toBe(false);
    expect(repository.findOne).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_001);
    findOne.mockResolvedValueOnce({ value: "true" });
    await expect(service.isAlertsEnabled()).resolves.toBe(true);
    expect(repository.findOne).toHaveBeenCalledTimes(2);
  });

  it("isAlertsEnabled по умолчанию true, если строки нет", async () => {
    const { service } = createService({
      findOne: null,
    });

    await expect(service.isAlertsEnabled()).resolves.toBe(true);
  });

  it("setAlertsEnabled записывает значение и сбрасывает кэш", async () => {
    const { service, repository, findOne } = createService();

    await service.setAlertsEnabled(false);
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY, value: "false" }),
      ["key"],
    );

    findOne.mockResolvedValueOnce({ value: "false" });
    await expect(service.isAlertsEnabled()).resolves.toBe(false);
  });
});
