import { Injectable } from "@nestjs/common";
import { Ctx, Command, Start, Update } from "nestjs-telegraf";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import {
  formatMarketMessage,
  formatSmartWhaleDetailMessage,
  formatSmartWhalesListMessage,
  formatStartMessage,
  formatStatsMessage,
  formatTopWhalesMessage,
} from "./telegram.formatter.js";

interface ReplyContext {
  payload?: string;
  reply(message: string, extra?: unknown): Promise<unknown> | unknown;
}

@Injectable()
@Update()
export class TelegramUpdate {
  constructor(
    private readonly marketsService: MarketsService,
    private readonly walletsService: WalletsService,
    private readonly smartWalletsService: SmartWalletsService,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
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

  @Command("whales")
  async handleWhales(@Ctx() ctx: ReplyContext): Promise<void> {
    const whitelist = await this.smartWalletsService.getActiveWhitelist();
    if (whitelist.length === 0) {
      await ctx.reply("Smart whale whitelist пуст.");
      return;
    }
    await ctx.reply(formatSmartWhalesListMessage(whitelist), { parse_mode: "Markdown" });
  }

  @Command("whale")
  async handleWhale(@Ctx() ctx: ReplyContext): Promise<void> {
    const address = ctx.payload?.trim() ?? "";
    if (address.length === 0) {
      await ctx.reply("Укажи адрес: /whale <0xADDR>");
      return;
    }

    const detail = await this.smartWalletsService.getWalletDetail(address);
    if (detail === null) {
      await ctx.reply("Кошелёк не найден в whitelist. Попробуй /whales для списка.");
      return;
    }

    await ctx.reply(formatSmartWhaleDetailMessage(detail), { parse_mode: "Markdown" });
  }

  @Command("stats")
  async handleStats(@Ctx() ctx: ReplyContext): Promise<void> {
    const [tradesCount, marketsCount, resolvedCount, smartCount] = await Promise.all([
      this.tradeRepository.count(),
      this.marketRepository.count(),
      this.marketRepository.count({
        where: { closed: true },
      }),
      this.smartWalletsService.getActiveWhitelist().then((l) => l.length),
    ]);

    const recentTrades = await this.tradeRepository
      .createQueryBuilder("t")
      .where("t.match_time >= :since", { since: new Date(Date.now() - 24 * 60 * 60 * 1000) })
      .getCount();

    await ctx.reply(
      formatStatsMessage({
        tradesTotal: tradesCount,
        trades24h: recentTrades,
        marketsTotal: marketsCount,
        marketsResolved: resolvedCount,
        smartWhalesActive: smartCount,
      }),
    );
  }
}
