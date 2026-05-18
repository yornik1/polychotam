import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export type WsConnectionKind = "open" | "close";

@Entity({ name: "ws_connection_events" })
export class WsConnectionEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 8 })
  kind!: WsConnectionKind;

  @Column({ type: "timestamptz" })
  at!: Date;
}
