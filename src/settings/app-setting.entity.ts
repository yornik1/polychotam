import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** Ключ-значение настроек приложения (глобальные флаги, переживают рестарт). */
@Entity({ name: "app_settings" })
export class AppSetting {
  @PrimaryColumn({ type: "varchar", length: 64 })
  key!: string;

  @Column({ type: "text" })
  value!: string;

  @UpdateDateColumn({ type: "timestamptz", name: "internal_updated_at" })
  internal_updated_at!: Date;
}
