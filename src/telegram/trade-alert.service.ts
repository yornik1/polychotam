import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { TelegramService } from "./telegram.service.js";

const DEFAULT_ALERT_THRESHOLD_AMOUNT = 1000;
const DEFAULT_ALERT_DEDUP_TTL_MS = 180_000;

interface TradeAlertInput {
  address: string;
  market: string;
  side: string;
  amount: string;
  /** Время сделки из WS (дедуп при ретраях BullMQ и повторах кадра). */
  tradeTimestamp?: number;
}

@Injectable()
export class TradeAlertService {
  private readonly recentAlertAt = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly marketsService: MarketsService,
    private readonly smartWalletsService: SmartWalletsService,
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

    const dedupTtlMs = this.resolveDedupTtlMs();
    const now = Date.now();
    this.pruneDedupEntries(now, dedupTtlMs);
    const dedupKey = this.buildDedupKey(input, address);
    const lastSent = this.recentAlertAt.get(dedupKey);
    if (
      lastSent !== undefined &&
      now - lastSent < dedupTtlMs
    ) {
      return false;
    }

    // Главное изменение: проверяем smart wallet whitelist вместо volume-based top whales
    const isSmartWhale = await this.smartWalletsService.isSmartWhale(address);
    if (!isSmartWhale) {
      return false;
    }

    const marketLabel = await this.resolveMarketLabel(input.market);
    const sent = await this.telegramService.sendAlert(
      this.formatAlertMessage(input, marketLabel, amount),
    );
    if (sent) {
      this.recentAlertAt.set(dedupKey, Date.now());
    }
    return sent;
  }

  private resolveDedupTtlMs(): number {
    const raw = this.configService.get<string>("ALERT_DEDUP_TTL_MS");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ALERT_DEDUP_TTL_MS;
    }
    return Math.min(Math.floor(parsed), 3_600_000);
  }

  private buildDedupKey(input: TradeAlertInput, normalizedAddress: string): string {
    const ts = input.tradeTimestamp ?? 0;
    return [
      normalizedAddress.toLowerCase(),
      input.market.trim().toLowerCase(),
      input.side,
      input.amount,
      String(ts),
    ].join("\u0001");
  }

  private pruneDedupEntries(now: number, ttlMs: number): void {
    const cutoff = now - ttlMs * 2;
    for (const [key, at] of this.recentAlertAt) {
      if (at < cutoff) {
        this.recentAlertAt.delete(key);
      }
    }
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
      "\u{1F6A8} Smart Whale Trade!",
      `Wallet: ${input.address}`,
      `Market: ${marketLabel}`,
      `Side: ${input.side}`,
      `Size: $${Math.round(amount).toLocaleString("en-US")}`,
    ].join("\n");
  }
}
