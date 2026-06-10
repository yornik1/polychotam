import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import type { WalletScoreSpecialization } from "../types/contracts.js";

/**
 * Скоринговая запись кошелька.
 *
 * score — взвешенное число 0..100:
 *   0.45 * norm(pnl_90d) + 0.35 * win_rate + 0.20 * pf_norm
 * где norm(pnl) = sigmoid(log(|pnl|+1) / log($10k+1)),
 *     pf_norm   = profitFactor / (profitFactor + 1), null → 0.5.
 *
 * Записи создаются только при sampleSize >= 30.
 * validated + win_rate >= SMART_TOP_MIN_WIN_RATE — попадает в /top.
 */
@Entity({ name: "wallet_scores" })
export class WalletScore {
  /** Адрес кошелька (proxy-wallet). */
  @PrimaryColumn({ type: "varchar", length: 128 })
  address!: string;

  /** PnL за 90 дней (USD). Nullable — если снапшот недоступен. */
  @Column({ type: "numeric", precision: 38, scale: 18, nullable: true })
  pnl_90d!: string | null;

  /** Win rate по resolved-сделкам (0..1). */
  @Column({ type: "numeric", precision: 10, scale: 8, nullable: true })
  win_rate!: string | null;

  /** Profit factor = Σ прибыли / Σ |убытков|. Null при нулевых убытках. */
  @Column({ type: "numeric", precision: 38, scale: 18, nullable: true })
  profit_factor!: string | null;

  /** Специализация по категориям маркетов: winRate + resolvedCount по каждой. */
  @Column({ type: "jsonb" })
  specialization!: WalletScoreSpecialization;

  /** Количество resolved-сделок за 90 дней. */
  @Column({ type: "integer" })
  sample_size!: number;

  /** Итоговый скоринговый балл 0..100. */
  @Column({ type: "numeric", precision: 10, scale: 6 })
  score!: string;

  /** Время последнего пересчёта. */
  @Column({ type: "timestamptz" })
  computed_at!: Date;

  @CreateDateColumn({ type: "timestamptz", name: "internal_created_at" })
  internal_created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", name: "internal_updated_at" })
  internal_updated_at!: Date;
}
