import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MarketsService } from "../markets/markets.service.js";
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
    private readonly marketsService: MarketsService,
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

    const marketLabel = await this.resolveMarketLabel(input.market);
    return this.telegramService.sendAlert(this.formatAlertMessage(input, marketLabel, amount));
  }

  private resolveThresholdAmount(): number {
    const rawValue = this.configService.get<string>("ALERT_THRESHOLD_AMOUNT");
    const parsed = Number(rawValue);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ALERT_THRESHOLD_AMOUNT;
    }

    return parsed;
  }

  private async resolveMarketLabel(conditionId: string): Promise<string> {
    const normalizedConditionId = conditionId.trim();
    if (normalizedConditionId.length === 0) {
      return conditionId;
    }

    const market = await this.marketsService.findByConditionId(normalizedConditionId);
    const question = market?.question?.trim();
    if (question !== undefined && question.length > 0) {
      return question;
    }

    const slug = market?.market_slug?.trim();
    if (slug !== undefined && slug.length > 0) {
      return slug;
    }

    return normalizedConditionId;
  }

  private formatAlertMessage(input: TradeAlertInput, marketLabel: string, amount: number): string {
    return [
      "🚨 Кит сделал ставку!",
      `Кошелёк: ${input.address}`,
      `Маркет: ${marketLabel}`,
      `Сторона: ${input.side}`,
      `Сумма: $${amount}`,
    ].join("\n");
  }
}
