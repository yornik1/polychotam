import { CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/**
 * Кошельки, на которые подписан пользователь (per-wallet алерты).
 * Decoupled от smart_wallets: подписка переживает деактивацию/удаление из whitelist.
 * Бот личный (один чат), поэтому chat_id не храним.
 */
@Entity({ name: "followed_wallets" })
export class FollowedWallet {
  @PrimaryColumn({ type: "varchar", length: 128 })
  address!: string;

  @CreateDateColumn({ type: "timestamptz", name: "internal_created_at" })
  internal_created_at!: Date;
}
