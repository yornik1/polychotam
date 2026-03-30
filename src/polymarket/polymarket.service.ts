import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PolymarketService {
  constructor(private readonly configService: ConfigService) {}

  getWsUrl(): string {
    return this.configService.getOrThrow<string>("POLYMARKET_WS_URL");
  }
}
