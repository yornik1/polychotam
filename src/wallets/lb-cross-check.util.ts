import type { WalletPnlDivergence } from "../types/contracts.js";

/** Пороги для классификации расхождения PnL v2 vs lb-api. */
export interface DivergenceThresholds {
  /** Абсолютный порог прохода (в $). */
  epsAbs: number;
  /** Относительный порог прохода (доля от |lb|). */
  epsRel: number;
  /** Абсолютный порог «на доисследование» (в $). */
  investigateAbs: number;
  /** Относительный порог «на доисследование» (доля от |lb|). */
  investigateRel: number;
}

/**
 * Классифицирует расхождение между PnL v2 и значением lb-api.
 *
 * Логика:
 *   pass:        |diff| ≤ max(epsAbs, epsRel·|lb|)
 *   investigate: |diff| > max(investigateAbs, investigateRel·|lb|)
 *   fail:        между pass и investigate
 *
 * При lb=0 max(epsAbs, epsRel·0) = epsAbs — абсолютный порог, как и ожидается.
 */
export function classifyDivergence(
  pnlV2: number,
  lbAmount: number,
  thresholds: DivergenceThresholds,
): WalletPnlDivergence["verdict"] {
  const diff = Math.abs(pnlV2 - lbAmount);
  const absLb = Math.abs(lbAmount);

  const passThreshold = Math.max(thresholds.epsAbs, thresholds.epsRel * absLb);
  const investigateThreshold = Math.max(
    thresholds.investigateAbs,
    thresholds.investigateRel * absLb,
  );

  if (diff <= passThreshold) {
    return "pass";
  }
  if (diff > investigateThreshold) {
    return "investigate";
  }
  return "fail";
}
