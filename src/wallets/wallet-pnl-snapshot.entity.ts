import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { WalletPnlV2Window } from "../types/contracts.js";

/**
 * Снапшот PnL v2 для одного кошелька на одном временном окне.
 *
 * `boundary_ids` — identity граничных записей (transactionHash + timestamp)
 * с ts == last_watermark_ts. Хранятся для дедупа при инклюзивном `start`
 * у /activity: следующий синк начинается с того же watermark, поэтому записи
 * с этим ts придут повторно — нужно отбросить ровно те, что уже посчитаны.
 *
 * `validated` — выставляется кросс-валидацией (T6): true, если расхождение
 * с lb-api не превышает ε на окнах all и 30d. Кошельки с validated=false
 * не попадают в /top.
 */
@Entity({ name: "wallet_pnl_snapshots" })
export class WalletPnlSnapshot {
  /** Адрес кошелька (proxy-wallet). */
  @PrimaryColumn({ type: "varchar", length: 128 })
  address!: string;

  /** Временное окно расчёта: "30d" | "90d" | "all". */
  @PrimaryColumn({ type: "varchar", length: 8 })
  window!: WalletPnlV2Window;

  /** Итоговый PnL = realizedPnl + openPositionsValue (MTM). */
  @Column({ type: "numeric", precision: 38, scale: 18 })
  pnl!: string;

  /** Реализованный cash-flow PnL (без MTM открытых позиций). */
  @Column({ type: "numeric", precision: 38, scale: 18 })
  realized_pnl!: string;

  /** Суммарная рыночная стоимость открытых позиций (MTM). */
  @Column({ type: "numeric", precision: 38, scale: 18 })
  open_positions_value!: string;

  /** Разбивка потоков по типу операции: { TRADE_BUY: -N, TRADE_SELL: +M, ... }. */
  @Column({ type: "jsonb" })
  by_operation!: Record<string, number>;

  /**
   * Unix-timestamp последней обработанной записи активности.
   * null — до первого успешного синка (данные ещё не загружались).
   */
  @Column({ type: "bigint", nullable: true })
  last_watermark_ts!: string | null;

  /**
   * Identity граничных записей (transactionHash + timestamp) с ts == last_watermark_ts.
   * Используется для дедупа при инклюзивном start /activity в T4.
   */
  @Column({ type: "jsonb" })
  boundary_ids!: { transactionHash: string; timestamp: number }[];

  /**
   * Типы операций, обработанных по гипотезе (SPLIT/MERGE/CONVERSION):
   * эмпирически не подтверждены, кошелёк видим в кросс-валидации отдельно.
   */
  @Column({ type: "jsonb" })
  hypothesis_types!: string[];

  /** Описания пропусков / неизвестных типов операций. */
  @Column({ type: "jsonb" })
  data_gaps!: string[];

  /**
   * true — прошёл кросс-валидацию с lb-api (T6) на окнах all и 30d.
   * Только validated=true кошельки попадают в /top.
   */
  @Column({ type: "boolean", default: false })
  validated!: boolean;

  /** Время последнего пересчёта снапшота. */
  @Column({ type: "timestamptz" })
  computed_at!: Date;

  @CreateDateColumn({ type: "timestamptz", name: "internal_created_at" })
  internal_created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", name: "internal_updated_at" })
  internal_updated_at!: Date;
}
