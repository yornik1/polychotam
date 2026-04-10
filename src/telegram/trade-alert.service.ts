import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WalletsService } from "../wallets/wallets.service.js";
import { TelegramService } from "./telegram.service.js";

const DEFAULT_ALERT_THRESHOLD_AMOUNT = 1000;

interface TradeAlertInput {
  address: string;
  market: string;
  side: string;
  amount: string;
}

@Injectable()
export class TradeAlertService {
  constructor(
    private readonly configService: ConfigService,
    private readonly walletsService: WalletsService,
    private readonly telegramService: TelegramService,
  ) {}

  async maybeSendTradeAlert(input: TradeAlertInput): Promise<boolean> {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < this.resolveThresholdAmount()) {
      return false;
    }

    const address = input.address.trim();
    if (address.length === 0) {
      return false;
    }

    const isTopWallet = await this.walletsService.isTopWallet(address);
    if (!isTopWallet) {
      return false;
    }

    return this.telegramService.sendAlert(this.formatAlertMessage(input, amount));
  }

  private resolveThresholdAmount(): number {
    const rawValue = this.configService.get<string>("ALERT_THRESHOLD_AMOUNT");
    const parsed = Number(rawValue);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ALERT_THRESHOLD_AMOUNT;
    }

    return parsed;
  }

  private formatAlertMessage(input: TradeAlertInput, amount: number): string {
    return [
      "🚨 Кит сделал ставку!",
      `Кошелёк: ${input.address}`,
      `Маркет: ${input.market}`,
      `Сторона: ${input.side}`,
      `Сумма: $${amount}`,
    ].join("\n");
  }
}
