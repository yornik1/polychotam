import type { WalletActivityRaw, WalletPositionRaw } from "../types/contracts.js";

/**
 * Результат computeCashFlowPnl — подмножество WalletPnlV2Summary
 * (без address/window/computedAt/validated — их добавляет сервис выше).
 */
export interface CashFlowPnlResult {
  realizedPnl: number;
  openPositionsValue: number;
  totalPnl: number;
  /** Суммы usdcSize по каждому ключу операции (TRADE:BUY, TRADE:SELL, REDEEM, ...). */
  byOperation: Record<string, number>;
  /** Типы операций, обработанные по гипотезе (SPLIT/MERGE/CONVERSION). */
  hypothesisTypes: string[];
  /** Описания пропущенных/неизвестных операций. */
  dataGaps: string[];
}

/**
 * Формула cash-flow PnL (утверждена консенсусом, эмпирически валидирована против lb-api):
 *
 *   realizedCashFlow = Σ usdcSize(TRADE:SELL, REDEEM, MERGE, REWARD, MAKER_REBATE)
 *                    − Σ usdcSize(TRADE:BUY, SPLIT)
 *   totalPnl = realizedCashFlow + Σ positions.currentValue
 *
 * Почему usdcSize, а не size×price:
 *   usdcSize — фактически переведённые USDC по транзакции (on-chain ground truth).
 *   size×price — оценка по торговой цене, может расходиться при частичном исполнении
 *   и не учитывает комиссии. lb-api тоже работает с денежным потоком, а не с лот×цена.
 *
 * Почему currentValue (MTM):
 *   lb-api включает mark-to-market открытых позиций — эмпирически подтверждено на
 *   0x2fb9a206 (realized-only −199.40, realized+MTM −8.34 vs lb −7.66). Без MTM
 *   расхождение с lb было бы ~191 USD.
 */
export function computeCashFlowPnl(
  activities: WalletActivityRaw[],
  positions: WalletPositionRaw[],
): CashFlowPnlResult {
  let realizedCashFlow = 0;
  const byOperation: Record<string, number> = {};
  const hypothesisTypes: string[] = [];
  const dataGaps: string[] = [];

  // Счётчики неизвестных типов для формирования dataGaps-строк
  const unknownTypeCounts: Record<string, number> = {};

  for (const activity of activities) {
    const { type, side, usdcSize } = activity;

    // Проверка числового значения usdcSize
    if (!Number.isFinite(usdcSize)) {
      dataGaps.push(`invalid usdcSize for type ${type}: ${usdcSize}`);
      continue;
    }

    // Обработка TRADE
    if (type === "TRADE") {
      if (side === "BUY") {
        const key = "TRADE:BUY";
        realizedCashFlow -= usdcSize;
        byOperation[key] = (byOperation[key] ?? 0) + usdcSize;
      } else if (side === "SELL") {
        const key = "TRADE:SELL";
        realizedCashFlow += usdcSize;
        byOperation[key] = (byOperation[key] ?? 0) + usdcSize;
      } else {
        dataGaps.push(`TRADE with unexpected side: ${String(side)}`);
      }
      continue;
    }

    // Подтверждённые притоки
    if (type === "REDEEM" || type === "REWARD" || type === "MAKER_REBATE") {
      realizedCashFlow += usdcSize;
      byOperation[type] = (byOperation[type] ?? 0) + usdcSize;
      continue;
    }

    // Гипотетические типы (эмпирически не встречались — обработаны по гипотезе)
    if (type === "SPLIT") {
      if (!hypothesisTypes.includes("SPLIT")) hypothesisTypes.push("SPLIT");
      realizedCashFlow -= usdcSize;
      byOperation["SPLIT"] = (byOperation["SPLIT"] ?? 0) + usdcSize;
      continue;
    }

    if (type === "MERGE") {
      if (!hypothesisTypes.includes("MERGE")) hypothesisTypes.push("MERGE");
      realizedCashFlow += usdcSize;
      byOperation["MERGE"] = (byOperation["MERGE"] ?? 0) + usdcSize;
      continue;
    }

    if (type === "CONVERSION") {
      if (!hypothesisTypes.includes("CONVERSION")) hypothesisTypes.push("CONVERSION");
      // CONVERSION не суммируется — природа неизвестна, помечается в dataGaps
      byOperation["CONVERSION"] = (byOperation["CONVERSION"] ?? 0) + usdcSize;
      unknownTypeCounts["CONVERSION"] = (unknownTypeCounts["CONVERSION"] ?? 0) + 1;
      continue;
    }

    // Неизвестный тип — не суммировать, записать в dataGaps
    unknownTypeCounts[type] = (unknownTypeCounts[type] ?? 0) + 1;
  }

  // Формируем строки dataGaps для неизвестных типов
  for (const [unknownType, count] of Object.entries(unknownTypeCounts)) {
    dataGaps.push(`unknown activity type ${unknownType}: ${count} records`);
  }

  // MTM открытых позиций
  const openPositionsValue = positions.reduce((sum, p) => sum + p.currentValue, 0);

  const totalPnl = realizedCashFlow + openPositionsValue;

  return {
    realizedPnl: realizedCashFlow,
    openPositionsValue,
    totalPnl,
    byOperation,
    hypothesisTypes,
    dataGaps,
  };
}
