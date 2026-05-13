import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Whitelist «умных» кошельков для алертов.
 * Адреса попадают сюда по результатам scoring (HR > 60%, sum PnL > 0, trades >= 10).
 */
@Entity({ name: "smart_wallets" })
export class SmartWallet {
  @PrimaryColumn({ type: "varchar", length: 128 })
  address!: string;

  /** Краткое описание / заметка (откуда адрес, что за игрок). */
  @Column({ type: "text", default: "" })
  notes!: string;

  /** Включён ли в активный whitelist для алертов. */
  @Column({ type: "boolean", default: true })
  active!: boolean;

  /** Последний известный hit rate (на момент добавления/пересчёта). */
  @Column({ type: "numeric", precision: 10, scale: 6, nullable: true })
  hit_rate!: string | null;

  /** Суммарный resolution PnL в USDC (на момент добавления/пересчёта). */
  @Column({ type: "numeric", precision: 38, scale: 18, nullable: true })
  sum_pnl!: string | null;

  /** ROI% (sum_pnl / notional * 100). */
  @Column({ type: "numeric", precision: 10, scale: 4, nullable: true })
  roi_pct!: string | null;

  /** Число whale trades при последнем расчёте. */
  @Column({ type: "int", default: 0 })
  whale_trade_count!: number;

  /** Источник добавления: 'manual' | 'auto_scoring' | 'research'. */
  @Column({ type: "varchar", length: 32, default: "manual" })
  source!: string;

  @CreateDateColumn({ type: "timestamptz", name: "internal_created_at" })
  internal_created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", name: "internal_updated_at" })
  internal_updated_at!: Date;
}
