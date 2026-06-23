import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FollowedWallet } from "./followed-wallet.entity.js";

/**
 * Сервис подписок на кошельки. Хранит множество followed-адресов (lowercase).
 * Используется TradeAlertService (роутинг алертов) и Telegram-карточкой (toggle).
 */
@Injectable()
export class FollowedWalletsService {
  constructor(
    @InjectRepository(FollowedWallet)
    private readonly followedRepository: Repository<FollowedWallet>,
  ) {}

  private normalize(address: string): string {
    return address.trim().toLowerCase();
  }

  /** Подписаться (идемпотентно). */
  async follow(address: string): Promise<void> {
    const normalized = this.normalize(address);
    if (normalized.length === 0) {
      return;
    }
    await this.followedRepository.upsert({ address: normalized }, ["address"]);
  }

  /** Отписаться. */
  async unfollow(address: string): Promise<void> {
    const normalized = this.normalize(address);
    if (normalized.length === 0) {
      return;
    }
    await this.followedRepository.delete({ address: normalized });
  }

  /** Подписан ли пользователь на кошелёк. */
  async isFollowed(address: string): Promise<boolean> {
    const normalized = this.normalize(address);
    if (normalized.length === 0) {
      return false;
    }
    const count = await this.followedRepository.count({ where: { address: normalized } });
    return count > 0;
  }

  /** Все followed-адреса (lowercase), новые первыми. */
  async list(): Promise<string[]> {
    const rows = await this.followedRepository.find({
      order: { internal_created_at: "DESC" },
    });
    return rows.map((r) => r.address);
  }
}
