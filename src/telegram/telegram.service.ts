import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class TelegramService {
  constructor(private readonly configService: ConfigService) {}

  getBotToken(): string {
    return this.configService.getOrThrow<string>("TELEGRAM_BOT_TOKEN");
  }
}
