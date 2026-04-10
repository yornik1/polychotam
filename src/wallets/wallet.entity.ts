import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * Агрегаты по кошельку (в CLOB нет такого объекта — доменная таблица приложения).
 */
@Entity({ name: "wallets" })
export class Wallet {
  @PrimaryColumn({ type: "varchar", length: 128 })
  address!: string;

  @Column({ type: "numeric", precision: 38, scale: 18, default: "0" })
  total_won!: string;

  @Column({ type: "numeric", precision: 38, scale: 18, default: "0" })
  total_lost!: string;

  @Column({ type: "numeric", precision: 10, scale: 6, default: "0" })
  win_rate!: string;

  @Column({ type: "int", default: 0 })
  trade_count!: number;

  @UpdateDateColumn({ type: "timestamptz", name: "internal_updated_at" })
  internal_updated_at!: Date;
}
