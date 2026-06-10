import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectBot } from "nestjs-telegraf";
import type { Telegraf } from "telegraf";

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Pick<Telegraf, "telegram">,
  ) {}

  getBotToken(): string {
    return this.configService.getOrThrow<string>("TELEGRAM_BOT_TOKEN");
  }

  async sendAlert(message: string): Promise<boolean> {
    const chatId = this.configService.get<string>("TELEGRAM_CHAT_ID")?.trim() ?? "";
    if (chatId.length === 0) {
      this.logger.warn("TELEGRAM_CHAT_ID не задан, alert пропущен");
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.error(`Не удалось отправить Telegram alert: ${errorMessage}`);
      return false;
    }
  }

  async sendAdminAlert(message: string): Promise<boolean> {
    const chatId = this.configService.getOrThrow<string>("ADMIN_CHAT_ID").trim();
    if (chatId.length === 0) {
      this.logger.warn("ADMIN_CHAT_ID пустой, admin alert пропущен");
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.error(`Не удалось отправить Telegram admin alert: ${errorMessage}`);
      return false;
    }
  }
}
