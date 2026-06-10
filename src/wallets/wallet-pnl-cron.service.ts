import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { QueueService } from "../queue/queue.service.js";
import { SmartWalletsService } from "./smart-wallets.service.js";

@Injectable()
export class WalletPnlCronService {
  private readonly logger = new Logger(WalletPnlCronService.name);

  constructor(
    private readonly smartWalletsService: SmartWalletsService,
    private readonly queueService: QueueService,
  ) {}

  /** Каждый час: ставит пересчёт PnL v2 для всех кошельков из активного whitelist. */
  @Cron("0 0 * * * *")
  async enqueuePnlRecalcForWhitelistJob(): Promise<void> {
    try {
      const wallets = await this.smartWalletsService.getActiveWhitelist();
      for (const wallet of wallets) {
        await this.queueService.enqueueWalletPnlRecalc(wallet.address);
      }
      if (wallets.length > 0) {
        this.logger.log(
          `Крон PnL: поставлен пересчёт для ${wallets.length} кошельков`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.warn(`Крон PnL: ${message}`);
    }
  }
}
