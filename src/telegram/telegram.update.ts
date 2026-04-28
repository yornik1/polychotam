import { Injectable } from "@nestjs/common";
import { Ctx, Command, Start, Update } from "nestjs-telegraf";
import { MarketsService } from "../markets/markets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import {
  formatMarketMessage,
  formatStartMessage,
  formatTopWhalesMessage,
} from "./telegram.formatter.js";

interface ReplyContext {
  payload?: string;
  reply(message: string): Promise<unknown> | unknown;
}

@Update()
@Injectable()
export class TelegramUpdate {
  constructor(
    private readonly marketsService: MarketsService,
    private readonly walletsService: WalletsService,
  ) {}

  @Start()
  async handleStart(@Ctx() ctx: ReplyContext): Promise<void> {
    await ctx.reply(formatStartMessage());
  }

  @Command("market")
  async handleMarket(@Ctx() ctx: ReplyContext): Promise<void> {
    const slug = ctx.payload?.trim() ?? "";
    if (slug.length === 0) {
      await ctx.reply("Укажи slug: /market <slug>");
      return;
    }

    const market = await this.marketsService.findBySlug(slug);
    if (market === null) {
      await ctx.reply("Маркет не найден. Попробуй другой slug.");
      return;
    }

    await ctx.reply(formatMarketMessage(market));
  }

  @Command("top")
  async handleTop(@Ctx() ctx: ReplyContext): Promise<void> {
    const whaleAddresses = await this.walletsService.getTopWalletsByVolumeOnTopMarkets(10);
    await ctx.reply(formatTopWhalesMessage(whaleAddresses));
  }
}
