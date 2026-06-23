import type { ClosedPositionRaw, DiscoveredWalletStats } from "../types/contracts.js";

/**
 * Чистые функции скоринга внешних (discovered) кошельков из data-api /closed-positions.
 *
 * Зачем отдельно от wallet-score.util: те функции считают по локальным Trade
 * (maker_address), а discovered-кошельков в локальной БД нет — их статистику
 * выводим из closed-positions (avgPrice, realizedPnl, totalBought).
 */

/** Порог цены входа, выше которого кошелёк считается near-resolution фермером. */
export const FARMER_AVG_ENTRY_THRESHOLD = 0.95;

/** Порог цены входа для insider-сигнала (прибыль на низковероятных входах). */
export const INSIDER_ENTRY_THRESHOLD = 0.35;

/** Коэффициент MAD для флага выброса (Hampel). */
export const MAD_OUTLIER_K = 4.5;

/** Медиана числового массива (без мутации входа). */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  const lo = sorted[mid - 1] ?? 0;
  return sorted.length % 2 === 0 ? (lo + hi) / 2 : hi;
}

/**
 * Median Absolute Deviation (Hampel). Возвращает MAD по серии.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const m = median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

/**
 * Флаг «PnL вытянут одним выбросом»: есть значение дальше k·MAD от медианы,
 * и его |вклад| превышает половину суммы модулей всей серии.
 * При MAD=0 (почти одинаковые значения) выброса нет.
 */
export function isOutlierDriven(values: readonly number[], k = MAD_OUTLIER_K): boolean {
  if (values.length < 3) {
    return false;
  }
  const m = median(values);
  const mad = medianAbsoluteDeviation(values);
  // Фолбэк: при MAD=0 (большинство значений идентичны) Hampel слепнет —
  // используем mean absolute deviation как меру разброса.
  const spread = mad > 0 ? mad : meanAbsoluteDeviation(values, m);
  if (spread === 0) {
    return false;
  }
  const totalMagnitude = values.reduce((sum, v) => sum + Math.abs(v), 0);
  if (totalMagnitude === 0) {
    return false;
  }
  for (const v of values) {
    const beyond = Math.abs(v - m) > k * spread;
    const dominates = Math.abs(v) > totalMagnitude / 2;
    if (beyond && dominates) {
      return true;
    }
  }
  return false;
}

/** Среднее абсолютное отклонение от центра (фолбэк для MAD=0). */
function meanAbsoluteDeviation(values: readonly number[], center: number): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + Math.abs(v - center), 0) / values.length;
}

/**
 * Байес-shrinkage винрейта к приору (когорта).
 * Малая выборка → результат тянется к priorMean; большая → к rawWinRate.
 *
 *   shrunk = (rawWinRate·sampleSize + priorMean·priorWeight) / (sampleSize + priorWeight)
 */
export function shrinkWinRate(
  rawWinRate: number,
  sampleSize: number,
  priorMean = 0.5,
  priorWeight = 30,
): number {
  const denom = sampleSize + priorWeight;
  if (denom <= 0) {
    return priorMean;
  }
  return (rawWinRate * sampleSize + priorMean * priorWeight) / denom;
}

/**
 * Выводит статистику кошелька из закрытых позиций.
 * Каждая closed-position — одна resolved ставка.
 */
export function computeDiscoveredStats(
  positions: readonly ClosedPositionRaw[],
): DiscoveredWalletStats {
  const sampleSize = positions.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      winRate: 0,
      realizedPnl: 0,
      roi: 0,
      avgEntryPrice: 0,
      edgeVsImplied: 0,
      insiderScore: 0,
      isFarmer: false,
      isOutlierDriven: false,
    };
  }

  let wins = 0;
  let realizedPnl = 0;
  let costBasis = 0;
  let entrySum = 0;
  let insiderWins = 0;

  for (const p of positions) {
    const pnl = Number.isFinite(p.realizedPnl) ? p.realizedPnl : 0;
    const entry = Number.isFinite(p.avgPrice) ? p.avgPrice : 0;
    const bought = Number.isFinite(p.totalBought) ? p.totalBought : 0;

    realizedPnl += pnl;
    costBasis += bought;
    entrySum += entry;

    if (pnl > 0) {
      wins += 1;
      if (entry < INSIDER_ENTRY_THRESHOLD) {
        insiderWins += 1;
      }
    }
  }

  const winRate = wins / sampleSize;
  const avgEntryPrice = entrySum / sampleSize;
  const roi = costBasis > 0 ? realizedPnl / costBasis : 0;
  const edgeVsImplied = winRate - avgEntryPrice;
  const insiderScore = wins > 0 ? insiderWins / wins : 0;
  const isFarmer = avgEntryPrice > FARMER_AVG_ENTRY_THRESHOLD;
  const outlierDriven = isOutlierDriven(
    positions.map((p) => (Number.isFinite(p.realizedPnl) ? p.realizedPnl : 0)),
  );

  return {
    sampleSize,
    winRate,
    realizedPnl,
    roi,
    avgEntryPrice,
    edgeVsImplied,
    insiderScore,
    isFarmer,
    isOutlierDriven: outlierDriven,
  };
}
