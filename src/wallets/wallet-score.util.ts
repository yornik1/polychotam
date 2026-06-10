/**
 * Чистые функции скоринга кошелька.
 *
 * Итоговый балл (0..100):
 *   score = 100 * (0.45 * normPnl + 0.35 * winRate + 0.20 * pfNorm)
 *
 * normPnl  = sigmoid(sign(pnl) * min(log(|pnl|+1)/log($10k+1), 1) * 4)
 *            где sigmoid(x) = 1/(1+exp(-x)), масштаб ~$10k → midpoint
 *            pnl=0 → 0.5; pnl=$10k → sigmoid(4) ≈ 0.982; pnl=-$10k → sigmoid(-4) ≈ 0.018
 *            коэффициент 4 задаёт чувствительность: полный диапазон при |pnl| ≈ $10k
 *
 * pfNorm   = pf / (pf + 1)  при pf != null, иначе 0.5 (нейтраль).
 *
 * Гейт: sampleSize < 30 → null (не хватает данных для доверия).
 */

export interface ComputeWalletScoreInput {
  pnl90d: number;
  winRate: number;
  profitFactor: number | null;
  sampleSize: number;
}

/** Сигмоида: 1 / (1 + e^(-x)). */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Нормирует pnl через log-масштаб с масштабом scale ($10k → midpoint).
 * Возвращает значение 0..1: 0.5 при pnl=0, →1 при больших +pnl, →0 при больших -pnl.
 *
 * Логика: вычисляем логарифмическую величину log(|pnl|+1)/log(scale+1) → [0, ~1],
 * затем применяем знак: положительный pnl → сдвигаем вправо от 0.5, отрицательный — влево.
 * sigmoid(signed) даёт монотонное отображение в (0,1) с серединой 0.5 при pnl=0.
 */
function normalizePnl(pnl: number, scale: number): number {
  const logVal = Math.log(Math.abs(pnl) + 1) / Math.log(scale + 1);
  const clipped = Math.min(logVal, 1);
  // Знаковый аргумент: положительный pnl → >0, отрицательный → <0, ноль → 0
  const signed = pnl >= 0 ? clipped : -clipped;
  // sigmoid(0)=0.5, sigmoid(+)>0.5, sigmoid(-)< 0.5
  return sigmoid(signed * 4); // коэффициент 4 — чувствительность нормировки
}

/**
 * Вычисляет скоринговый балл кошелька (0..100).
 *
 * Возвращает null, если sampleSize < 30 — недостаточно данных.
 *
 * Веса: pnl90d=0.45, winRate=0.35, profitFactor=0.20.
 */
export function computeWalletScore(input: ComputeWalletScoreInput): number | null {
  const { pnl90d, winRate, profitFactor, sampleSize } = input;

  // Гейт: минимальный размер выборки
  if (sampleSize < 30) {
    return null;
  }

  // Нормировка PnL через log-scale / сигмоиду, масштаб $10k
  const normPnl = normalizePnl(pnl90d, 10_000);

  // Win rate уже в диапазоне 0..1
  const normWinRate = winRate;

  // Profit factor: pf/(pf+1), null → нейтральное 0.5
  const pfNorm = profitFactor !== null ? profitFactor / (profitFactor + 1) : 0.5;

  const raw = 0.45 * normPnl + 0.35 * normWinRate + 0.20 * pfNorm;
  return Math.round(raw * 100 * 1e6) / 1e6; // сохраняем точность до 6 знаков
}
