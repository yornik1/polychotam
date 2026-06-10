import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import type { WalletActivityRaw, WalletPnlV2Summary, WalletPnlV2Window } from "../types/contracts.js";
import { DataApiClient } from "../polymarket/data-api.client.js";
import { computeCashFlowPnl } from "./wallet-pnl-v2.util.js";
import { WalletPnlSnapshot } from "./wallet-pnl-snapshot.entity.js";

/** Дефолтный TTL снапшота — 6 часов. */
const DEFAULT_WALLET_PNL_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Identity-строка одной записи активности для граничного дедупа.
 * Формат: `${transactionHash}|${asset}|${side}|${outcomeIndex}|${type}|${usdcSize}`
 */
function makeIdentity(a: WalletActivityRaw): string {
  return [
    a.transactionHash,
    a.asset ?? "",
    a.side ?? "",
    a.outcomeIndex ?? "",
    a.type,
    a.usdcSize,
  ].join("|");
}

/**
 * Удаляет из массива записи, которые совпадают с граничными идентити из предыдущего снапшота.
 * Дедуп — только точное совпадение count: если в boundary 2 одинаковых — удаляем 2 штуки,
 * не больше (лишние считаются новыми легитимными).
 */
function deduplicateBoundary(
  activities: WalletActivityRaw[],
  boundaryIds: string[],
): WalletActivityRaw[] {
  // Считаем сколько раз каждая identity встречается в boundary
  const remaining = new Map<string, number>();
  for (const id of boundaryIds) {
    remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }

  const result: WalletActivityRaw[] = [];
  for (const a of activities) {
    const id = makeIdentity(a);
    const count = remaining.get(id) ?? 0;
    if (count > 0) {
      // Удаляем ровно одно совпадение (по счётчику)
      remaining.set(id, count - 1);
    } else {
      result.push(a);
    }
  }
  return result;
}

/**
 * Складывает два byOperation-словаря поэлементно.
 */
function mergeByOperation(
  base: Record<string, number>,
  delta: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
}

@Injectable()
export class WalletPnlV2Service {
  constructor(
    @InjectRepository(WalletPnlSnapshot)
    private readonly snapshotRepository: Repository<WalletPnlSnapshot>,
    private readonly dataApiClient: DataApiClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Инкрементальный пересчёт PnL для заданного окна.
   * Для window="all": инкрементально от watermark.
   * Для window="30d"/"90d": полный пересчёт с нуля (скользящее окно).
   *
   * Атомарность: снапшот обновляется одним save только при полном успехе.
   * Любая ошибка страницы — throw, снапшот остаётся старым.
   */
  async recalc(address: string, window: WalletPnlV2Window): Promise<void> {
    if (window === "all") {
      await this.recalcAll(address);
    } else {
      await this.recalcWindow(address, window, window === "30d" ? 30 : 90);
    }
  }

  /**
   * Вернуть PnL из снапшота если он свежее TTL, иначе пересчитать и вернуть.
   */
  async getOrComputePnl(address: string, window: WalletPnlV2Window): Promise<WalletPnlV2Summary> {
    const ttlMs = this.resolveTtlMs();
    const existing = await this.snapshotRepository.findOne({
      where: { address, window },
    });

    if (existing !== null && existing.computed_at.getTime() + ttlMs > Date.now()) {
      return this.snapshotToSummary(existing);
    }

    await this.recalc(address, window);

    const snapshot = await this.snapshotRepository.findOne({
      where: { address, window },
    });

    if (snapshot === null) {
      throw new Error(`WalletPnlV2Service: снапшот не найден после recalc для ${address}/${window}`);
    }

    return this.snapshotToSummary(snapshot);
  }

  /**
   * Инкрементальный синк полной истории (window="all").
   */
  private async recalcAll(address: string): Promise<void> {
    const existing = await this.snapshotRepository.findOne({
      where: { address, window: "all" },
    });

    const watermark = existing?.last_watermark_ts != null
      ? Number(existing.last_watermark_ts)
      : null;

    // Загружаем активность: с watermark (инклюзивно) или всю историю
    const rawActivities = await this.dataApiClient.fetchAllActivity(address, {
      start: watermark ?? undefined,
      sortDirection: "ASC",
    });

    // Применяем граничный дедуп: записи с ts == watermark могут прийти повторно
    let newActivities: WalletActivityRaw[];
    if (watermark !== null && existing !== null) {
      const boundaryIds = this.extractBoundaryIds(existing.boundary_ids);
      const atWatermark = rawActivities.filter((a) => a.timestamp === watermark);
      const afterWatermark = rawActivities.filter((a) => a.timestamp > watermark);

      // Дедупим только записи на граничном timestamp
      const deduped = deduplicateBoundary(atWatermark, boundaryIds);
      newActivities = [...deduped, ...afterWatermark];
    } else {
      newActivities = rawActivities;
    }

    // Если новых записей нет — watermark и агрегаты не меняем, только обновляем computed_at
    const positions = await this.dataApiClient.fetchPositions(address);
    const pnlResult = computeCashFlowPnl(newActivities, positions);

    // Определяем новый watermark: max(ts) из всех обработанных записей
    let newWatermark: number | null = watermark;
    if (rawActivities.length > 0) {
      const maxTs = Math.max(...rawActivities.map((a) => a.timestamp));
      newWatermark = maxTs;
    }

    // Новые boundary_ids — identity записей с ts == новый watermark
    let newBoundaryIds: string[] = [];
    if (newWatermark !== null && rawActivities.length > 0) {
      newBoundaryIds = rawActivities
        .filter((a) => a.timestamp === newWatermark)
        .map(makeIdentity);
    }

    // Накопление агрегата: прибавляем вклад новых операций к предыдущим
    const prevByOperation = existing?.by_operation ?? {};
    const prevRealized = existing !== null ? Number(existing.realized_pnl) : 0;

    const mergedByOperation = mergeByOperation(prevByOperation, pnlResult.byOperation);
    const mergedRealized = prevRealized + pnlResult.realizedPnl;
    const totalPnl = mergedRealized + pnlResult.openPositionsValue;

    const now = new Date();
    const snapshot = this.buildSnapshot({
      address,
      window: "all",
      existing,
      realizedPnl: mergedRealized,
      openPositionsValue: pnlResult.openPositionsValue,
      totalPnl,
      byOperation: mergedByOperation,
      hypothesisTypes: pnlResult.hypothesisTypes,
      dataGaps: pnlResult.dataGaps,
      watermark: newWatermark,
      boundaryIds: newBoundaryIds,
      computedAt: now,
    });

    await this.snapshotRepository.save(snapshot);
  }

  /**
   * Полный пересчёт скользящего окна (30d или 90d) — без инкрементальности.
   * start = now − N*86400 секунд (unix).
   */
  private async recalcWindow(
    address: string,
    window: WalletPnlV2Window,
    days: number,
  ): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - days * 86400;

    const rawActivities = await this.dataApiClient.fetchAllActivity(address, {
      start: startSec,
      sortDirection: "ASC",
    });

    const positions = await this.dataApiClient.fetchPositions(address);
    const pnlResult = computeCashFlowPnl(rawActivities, positions);

    // Watermark для скользящих окон (30d/90d) чисто информативен:
    // синк их всегда пересчитывает полностью от now − N дней, инкрементальность
    // по watermark применяется только к окну "all" (см. recalcAll)
    let newWatermark: number | null = null;
    if (rawActivities.length > 0) {
      newWatermark = Math.max(...rawActivities.map((a) => a.timestamp));
    }

    const existing = await this.snapshotRepository.findOne({
      where: { address, window },
    });

    const now = new Date();
    const snapshot = this.buildSnapshot({
      address,
      window,
      existing,
      realizedPnl: pnlResult.realizedPnl,
      openPositionsValue: pnlResult.openPositionsValue,
      totalPnl: pnlResult.totalPnl,
      byOperation: pnlResult.byOperation,
      hypothesisTypes: pnlResult.hypothesisTypes,
      dataGaps: pnlResult.dataGaps,
      watermark: newWatermark,
      boundaryIds: [],
      computedAt: now,
    });

    await this.snapshotRepository.save(snapshot);
  }

  /**
   * Собирает объект снапшота для сохранения.
   * Если снапшот уже существует — обновляет поля; иначе создаёт новый.
   * validated всегда сбрасывается в false (кросс-валидация — T6).
   */
  private buildSnapshot(params: {
    address: string;
    window: WalletPnlV2Window;
    existing: WalletPnlSnapshot | null;
    realizedPnl: number;
    openPositionsValue: number;
    totalPnl: number;
    byOperation: Record<string, number>;
    hypothesisTypes: string[];
    dataGaps: string[];
    watermark: number | null;
    boundaryIds: string[];
    computedAt: Date;
  }): WalletPnlSnapshot {
    const snapshot = params.existing ?? this.snapshotRepository.create();
    snapshot.address = params.address;
    snapshot.window = params.window;
    snapshot.pnl = String(params.totalPnl);
    snapshot.realized_pnl = String(params.realizedPnl);
    snapshot.open_positions_value = String(params.openPositionsValue);
    snapshot.by_operation = params.byOperation;
    snapshot.hypothesis_types = params.hypothesisTypes;
    snapshot.data_gaps = params.dataGaps;
    snapshot.last_watermark_ts = params.watermark !== null ? String(params.watermark) : null;
    snapshot.boundary_ids = params.boundaryIds.map((id) => ({
      transactionHash: id,
      timestamp: params.watermark ?? 0,
    }));
    snapshot.validated = false;
    snapshot.computed_at = params.computedAt;
    return snapshot;
  }

  /**
   * Извлекает строки идентити из boundary_ids снапшота.
   * Снапшот хранит { transactionHash, timestamp }, но transactionHash у нас
   * содержит полный identity-ключ (makeIdentity).
   */
  private extractBoundaryIds(
    boundaryIds: { transactionHash: string; timestamp: number }[],
  ): string[] {
    return boundaryIds.map((b) => b.transactionHash);
  }

  private snapshotToSummary(snapshot: WalletPnlSnapshot): WalletPnlV2Summary {
    return {
      address: snapshot.address,
      window: snapshot.window,
      method: "cash_flow_wallet_activity",
      realizedPnl: Number(snapshot.realized_pnl),
      openPositionsValue: Number(snapshot.open_positions_value),
      totalPnl: Number(snapshot.pnl),
      byOperation: snapshot.by_operation,
      hypothesisTypes: snapshot.hypothesis_types,
      dataGaps: snapshot.data_gaps,
      validated: snapshot.validated,
      computedAt: snapshot.computed_at.toISOString(),
    };
  }

  private resolveTtlMs(): number {
    const raw = this.configService.get<string>("WALLET_PNL_TTL_MS");
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WALLET_PNL_TTL_MS;
  }
}
