import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn
} from "typeorm";

/**
 * Снимок маркета CLOB (`GET /markets`).
 * Имена колонок совпадают с Polymarket API / PolymarketMarketRaw.
 */
@Entity({ name: "markets" })
@Index("idx_markets_active_closed", ["active", "closed"])
@Index("idx_markets_end_date_iso", ["end_date_iso"])
@Index("idx_markets_volume24hr", ["volume24hr"])
export class Market {
  @PrimaryColumn({ type: "varchar", length: 128 })
  condition_id!: string;

  @Column({ type: "text" })
  question!: string;

  @Column({ type: "varchar", length: 512, unique: true })
  market_slug!: string;

  @Column({ type: "jsonb" })
  tokens!: unknown;

  @Column({ type: "varchar", length: 256, nullable: true })
  winning_token_id!: string | null;

  @Column({ type: "varchar", length: 256, nullable: true })
  winning_outcome!: string | null;

  @Column({ type: "boolean" })
  active!: boolean;

  @Column({ type: "boolean" })
  closed!: boolean;

  @Column({ type: "boolean", nullable: true })
  accepting_orders!: boolean | null;

  @Column({ type: "double precision", default: 0 })
  liquidity!: number;

  @Column({ type: "double precision", default: 0 })
  volume24hr!: number;

  /** ISO-строка как в upstream; тип text сохраняет значение 1:1 с API. */
  @Column({ type: "text", nullable: true })
  end_date_iso!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  internal_synced_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz", name: "internal_created_at" })
  internal_created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", name: "internal_updated_at" })
  internal_updated_at!: Date;
}
