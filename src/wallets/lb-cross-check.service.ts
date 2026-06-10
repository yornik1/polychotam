import { forwardRef, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import type { LbProfitWindow, WalletPnlDivergence } from "../types/contracts.js";
import { DataApiClient } from "../polymarket/data-api.client.js";
import { TelegramService } from "../telegram/telegram.service.js";
import { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";
import { classifyDivergence } from "./lb-cross-check.util.js";
import type { DivergenceThresholds } from "./lb-cross-check.util.js";

/**
 * Пороги кросс-валидации.
 * Калибровочные значения по эмпирическим спайкам 2026-06-10;
 * НЕ подгонять под зелёные тесты.
 */
const DEFAULT_EPS_ABS = 1;
const DEFAULT_EPS_REL = 0.01;
const DEFAULT_INVESTIGATE_ABS = 50;
const DEFAULT_INVESTIGATE_REL = 0.02;

/** Окна, по которым проводится кросс-валидация (90d в lb-api отсутствует). */
const VALIDATION_WINDOWS: LbProfitWindow[] = ["all", "30d"];

@Injectable()
export class LbCrossCheckService {
  private readonly logger = new Logger(LbCrossCheckService.name);

  constructor(
    @InjectRepository(WalletPnlSnapshot)
    private readonly snapshotRepo: Repository<WalletPnlSnapshot>,
    private readonly pnlV2Service: WalletPnlV2Service,
    private readonly dataApiClient: DataApiClient,
    private readonly configService: ConfigService,
    /**
     * TelegramService инжектируется опционально с forwardRef, так как TelegramModule
     * импортирует WalletsModule — прямой импорт TelegramModule в WalletsModule
     * создал бы цикл. forwardRef + @Optional позволяет разрешить зависимость
     * когда модуль доступен, и продолжить работу (без алертов) при его отсутствии.
     */
    @Optional()
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService | null,
  ) {}

  /**
   * Валидирует кошелёк против lb-api на окнах all и 30d.
   *
   * Алгоритм:
   *   1. Для каждого из окон получить pnl_v2 (getOrComputePnl) и lb (fetchLbProfit).
   *   2. lb null (кошелька нет в лидерборде) → validated=false, без алерта.
   *   3. Классифицировать расхождение (classifyDivergence).
   *   4. fail → admin-алерт с числами; investigate → отдельный алерт «доисследование».
   *   5. Все окна pass → validated=true для всех снапшотов кошелька,
   *      иначе validated=false.
   */
  async validateWallet(address: string): Promise<void> {
    const thresholds = this.resolveThresholds();
    const divergences: WalletPnlDivergence[] = [];
    let lbMissing = false;

    for (const window of VALIDATION_WINDOWS) {
      // Для 30d PnL v2 использует то же окно
      const pnlWindow = window === "all" ? "all" : "30d";
      const pnlSummary = await this.pnlV2Service.getOrComputePnl(address, pnlWindow);
      const lbResult = await this.dataApiClient.fetchLbProfit(address, window);

      if (lbResult === null) {
        this.logger.warn(
          `validateWallet: ${address} не найден в lb-api (window=${window}) → validated=false без алерта`,
        );
        lbMissing = true;
        break;
      }

      const pnlV2 = pnlSummary.totalPnl;
      const lbAmount = lbResult.amount;
      const diff = pnlV2 - lbAmount;
      const verdict = classifyDivergence(pnlV2, lbAmount, thresholds);

      divergences.push({ address, window, pnlV2, lbAmount, diff, verdict });

      // Собираем hypothesisTypes из снапшота для упоминания в алерте
      const hypothesisNote = await this.buildHypothesisNote(address, pnlWindow);

      if (verdict === "fail") {
        await this.sendAlert(
          `⚠️ PnL кросс-валидация FAIL\n` +
            `Кошелёк: ${address}\n` +
            `Окно: ${window}\n` +
            `PnL v2: ${pnlV2.toFixed(2)}\n` +
            `lb: ${lbAmount.toFixed(2)}\n` +
            `diff: ${diff.toFixed(2)}${hypothesisNote}`,
        );
      } else if (verdict === "investigate") {
        await this.sendAlert(
          `🔍 PnL кросс-валидация INVESTIGATE — нужно доисследование CONVERSION/negRisk\n` +
            `Кошелёк: ${address}\n` +
            `Окно: ${window}\n` +
            `PnL v2: ${pnlV2.toFixed(2)}\n` +
            `lb: ${lbAmount.toFixed(2)}\n` +
            `diff: ${diff.toFixed(2)}${hypothesisNote}`,
        );
      }
    }

    const allPass =
      !lbMissing &&
      divergences.length === VALIDATION_WINDOWS.length &&
      divergences.every((d) => d.verdict === "pass");

    await this.updateValidated(address, allPass);
  }

  /**
   * Обновляет поле validated во всех снапшотах кошелька.
   */
  private async updateValidated(address: string, validated: boolean): Promise<void> {
    await this.snapshotRepo.update({ address }, { validated });
  }

  /**
   * Возвращает текстовую заметку о hypothesis_types из снапшота,
   * если встречались SPLIT/MERGE/CONVERSION.
   */
  private async buildHypothesisNote(
    address: string,
    window: "30d" | "90d" | "all",
  ): Promise<string> {
    const snapshot = await this.snapshotRepo.findOne({ where: { address, window } });
    if (!snapshot || snapshot.hypothesis_types.length === 0) {
      return "";
    }
    return `\nГипотетические типы в снапшоте: ${snapshot.hypothesis_types.join(", ")}`;
  }

  private async sendAlert(message: string): Promise<void> {
    if (this.telegramService === null) {
      this.logger.warn(`sendAlert: TelegramService недоступен. Сообщение: ${message}`);
      return;
    }
    await this.telegramService.sendAdminAlert(message);
  }

  /**
   * Читает пороги из ConfigService с дефолтными значениями.
   * Калибровочные значения по эмпирическим спайкам 2026-06-10;
   * НЕ подгонять под зелёные тесты.
   */
  private resolveThresholds(): DivergenceThresholds {
    return {
      epsAbs: this.getNumberConfig("WALLET_PNL_EPS_ABS", DEFAULT_EPS_ABS),
      epsRel: this.getNumberConfig("WALLET_PNL_EPS_REL", DEFAULT_EPS_REL),
      investigateAbs: this.getNumberConfig("WALLET_PNL_INVESTIGATE_ABS", DEFAULT_INVESTIGATE_ABS),
      investigateRel: this.getNumberConfig("WALLET_PNL_INVESTIGATE_REL", DEFAULT_INVESTIGATE_REL),
    };
  }

  private getNumberConfig(key: string, defaultValue: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
  }
}
