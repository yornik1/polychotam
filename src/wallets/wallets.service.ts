import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Wallet } from "./wallet.entity.js";

/** Поля агрегата для upsert (numeric в БД — строки, как в entity). */
export type WalletUpsertInput = Pick<
  Wallet,
  "address" | "total_won" | "total_lost" | "win_rate"
>;

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  /**
   * Создаёт или обновляет строку кошелька одним запросом (ON CONFLICT по address).
   */
  async upsert(data: WalletUpsertInput): Promise<void> {
    await this.walletRepository.upsert(
      {
        ...data,
        internal_updated_at: new Date(),
      },
      ["address"],
    );
  }
}
