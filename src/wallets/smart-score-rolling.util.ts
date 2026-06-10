/**
 * Утилиты rolling-мониторинга автоисключения кошельков из whitelist.
 *
 * Схема хранения серии: счётчик consecutive_low_winrate_days в таблице smart_wallets.
 * При каждом ежедневном пересчёте:
 *   winRate < порога → счётчик+1
 *   winRate >= порога → счётчик = 0
 *   счётчик >= ROLLING_DEACTIVATION_THRESHOLD → деактивация
 */

/** Число дней подряд с низким винрейтом, при котором кошелёк деактивируется. */
export const ROLLING_DEACTIVATION_THRESHOLD = 14;

export interface RollingCheckInput {
  /** Текущий winRate кошелька (0..1). Null означает нет данных — трактуется как «ниже порога». */
  winRate: number | null;
  /** Текущее значение счётчика (из БД). */
  consecutiveLowWinrateDays: number;
  /** Минимальный приемлемый винрейт (из ConfigService). */
  minWinRate: number;
}

export interface RollingCheckResult {
  /** Новое значение счётчика (записать в БД). */
  newConsecutiveDays: number;
  /** true — кошелёк нужно деактивировать. */
  shouldDeactivate: boolean;
}

/**
 * Вычисляет новое состояние счётчика серии низкого винрейта.
 * Чистая функция без побочных эффектов.
 *
 * Логика:
 *   - winRate < minWinRate (или null) → counter + 1
 *   - winRate >= minWinRate           → counter = 0
 *   - counter >= ROLLING_DEACTIVATION_THRESHOLD → shouldDeactivate = true
 */
export function computeRollingCheck(input: RollingCheckInput): RollingCheckResult {
  const isBelowThreshold = input.winRate === null || input.winRate < input.minWinRate;

  const newConsecutiveDays = isBelowThreshold ? input.consecutiveLowWinrateDays + 1 : 0;

  const shouldDeactivate = newConsecutiveDays >= ROLLING_DEACTIVATION_THRESHOLD;

  return { newConsecutiveDays, shouldDeactivate };
}
