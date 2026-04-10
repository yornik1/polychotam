import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn
} from "typeorm";
import { Market } from "../markets/market.entity.js";

/**
 * Сделка CLOB (тип `Trade` в @polymarket/clob-client).
 * Колонка `market` — condition id, как в API.
 */
@Entity({ name: "trades" })
@Index("idx_trades_market_match_time", ["market", "match_time"])
@Index("idx_trades_owner_match_time", ["owner", "match_time"])
@Index("idx_trades_maker_address_match_time", ["maker_address", "match_time"])
@Index("idx_trades_asset_id_match_time", ["asset_id", "match_time"])
export class Trade {
  @PrimaryColumn({ type: "varchar", length: 256 })
  id!: string;

  @Column({ type: "varchar", length: 256, unique: true, nullable: true })
  trade_id!: string | null;

  @Column({ type: "varchar", length: 256 })
  taker_order_id!: string;

  @ManyToOne(() => Market, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "market", referencedColumnName: "condition_id" })
  market!: Market;

  @Column({ type: "varchar", length: 256 })
  asset_id!: string;

  @Column({ type: "varchar", length: 8 })
  side!: string;

  @Column({ type: "varchar", length: 128 })
  size!: string;

  @Column({ type: "varchar", length: 64 })
  fee_rate_bps!: string;

  @Column({ type: "varchar", length: 128 })
  price!: string;

  @Column({ type: "varchar", length: 64 })
  status!: string;

  @Column({ type: "timestamptz" })
  match_time!: Date;

  @Column({ type: "timestamptz" })
  last_update!: Date;

  @Column({ type: "varchar", length: 256 })
  outcome!: string;

  @Column({ type: "int" })
  bucket_index!: number;

  @Column({ type: "varchar", length: 128 })
  owner!: string;

  @Column({ type: "varchar", length: 128 })
  maker_address!: string;

  @Column({ type: "jsonb" })
  maker_orders!: unknown;

  @Column({ type: "varchar", length: 128 })
  transaction_hash!: string;

  @Column({ type: "varchar", length: 16 })
  trader_side!: string;
}
