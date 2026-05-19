import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export type WsConnectionKind = "open" | "close";

@Entity({ name: "ws_connection_events" })
export class WsConnectionEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 8 })
  kind!: WsConnectionKind;

  @Column({ type: "timestamptz" })
  at!: Date;

  /** Время вставки строки (для диагностики и восстановления после сбоев). */
  @CreateDateColumn({ type: "timestamptz", name: "internal_created_at" })
  internal_created_at!: Date;
}
