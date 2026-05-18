import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppSetting } from "./app-setting.entity.js";

/** Глобальные флаги алертов (один chat_id). */
@Injectable()
export class AlertSettingsService {
  private static readonly KEY_ALERTS_ENABLED = "alerts_enabled";
  private static readonly CACHE_TTL_MS = 30_000;

  private cache: { value: boolean; expiresAt: number } | null = null;

  constructor(
    @InjectRepository(AppSetting)
    private readonly appSettingRepository: Repository<AppSetting>,
  ) {}

  async isAlertsEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.cache !== null && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const row = await this.appSettingRepository.findOne({
      where: { key: AlertSettingsService.KEY_ALERTS_ENABLED },
    });
    const enabled = this.parseAlertsFlag(row?.value);
    this.cache = { value: enabled, expiresAt: now + AlertSettingsService.CACHE_TTL_MS };
    return enabled;
  }

  async setAlertsEnabled(enabled: boolean): Promise<void> {
    await this.appSettingRepository.upsert(
      {
        key: AlertSettingsService.KEY_ALERTS_ENABLED,
        value: enabled ? "true" : "false",
      },
      ["key"],
    );
    this.cache = null;
  }

  /** Строка из БД → boolean; отсутствие строки — по умолчанию включено. */
  private parseAlertsFlag(raw: string | null | undefined): boolean {
    if (raw === null || raw === undefined) {
      return true;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized !== "false" && normalized !== "0" && normalized !== "off";
  }
}
