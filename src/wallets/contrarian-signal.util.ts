import type { TradeSide } from "../types/contracts.js";

/**
 * Детектор high-edge contrarian-сигнала (паттерн Depthy):
 * топ-кошелёк покупает No на рынке, где Yes торгуется выше порога (фаворит),
 * то есть ставит против тяжёлого фаворита по дешёвой цене.
 */

/** Порог цены Yes, выше которого покупка No считается контрарным сигналом. */
export const CONTRARIAN_YES_THRESHOLD = 0.8;

/** Индекс исхода Polymarket: 0 = Yes, 1 = No. */
export const OUTCOME_INDEX_NO = 1;

export interface ContrarianSignalInput {
  /** Кошелёк входит в активный whitelist (smart money). */
  isTopWallet: boolean;
  /** Сторона сделки. */
  side: TradeSide;
  /** Индекс исхода (0 = Yes, 1 = No). */
  outcomeIndex: number;
  /** Текущая цена Yes в долях [0, 1]. */
  yesPrice: number;
}

/**
 * true, если сделка — контрарная покупка No топ-кошельком при Yes выше порога.
 */
export function isContrarianNoSignal(
  input: ContrarianSignalInput,
  yesThreshold = CONTRARIAN_YES_THRESHOLD,
): boolean {
  return (
    input.isTopWallet &&
    input.side === "BUY" &&
    input.outcomeIndex === OUTCOME_INDEX_NO &&
    input.yesPrice > yesThreshold
  );
}

/**
 * Выводит цену Yes из цены купленного исхода: для Yes (index 0) — как есть,
 * для No (index 1) — дополнение до 1 (Yes + No ≈ 1 на Polymarket).
 */
export function deriveYesPrice(outcomeIndex: number, outcomePrice: number): number {
  return outcomeIndex === OUTCOME_INDEX_NO ? 1 - outcomePrice : outcomePrice;
}
