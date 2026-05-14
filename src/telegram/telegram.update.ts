import { Injectable } from "@nestjs/common";
import { Ctx, Command, Start, Update } from "nestjs-telegraf";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { QueueStatsService } from "../queue/queue-stats.service.js";
import { PolymarketWsStatusService } from "../polymarket/polymarket-ws-status.service.js";
import {
  formatErrorsMessage,
  formatMarketMessage,
  formatQueuesMessage,
  formatSmartWhaleDetailMessage,
  formatSmartWhalesListMessage,
  formatStartMessage,
  formatStatsMessage,
  formatTopWhalesMessage,
  formatWsStatusMessage,
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
    private readonly queueStatsService: QueueStatsService,
    private readonly wsStatusService: PolymarketWsStatusService,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
  ) {}

  @Start()
  async handleStart(@Ctx() ctx: ReplyContext): Promise<void> {
    await ctx.reply(formatStartMessage(), { parse_mode: "HTML" });
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
    await ctx.reply(formatTopWhalesMessage(whaleAddresses), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  @Command("whales")
  async handleWhales(@Ctx() ctx: ReplyContext): Promise<void> {
    const whitelist = await this.smartWalletsService.getActiveWhitelist();
    if (whitelist.length === 0) {
      await ctx.reply("Smart whale whitelist пуст.");
      return;
    }
    await ctx.reply(formatSmartWhalesListMessage(whitelist), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
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

    await ctx.reply(formatSmartWhaleDetailMessage(detail), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
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

  @Command("queues")
  async handleQueues(@Ctx() ctx: ReplyContext): Promise<void> {
    const counts = await this.queueStatsService.getAllQueueCounts();
    await ctx.reply(formatQueuesMessage(counts), { parse_mode: "HTML" });
  }

  @Command("errors")
  async handleErrors(@Ctx() ctx: ReplyContext): Promise<void> {
    const limitRaw = ctx.payload?.trim() ?? "";
    const limit = Math.max(
      1,
      Math.min(20, Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0 ? Number(limitRaw) : 5),
    );
    const result = await this.queueStatsService.getRecentErrors(limit);
    await ctx.reply(formatErrorsMessage(result.entries, result.totalInTail), {
      parse_mode: "HTML",
    });
  }

  @Command("ws")
  async handleWs(@Ctx() ctx: ReplyContext): Promise<void> {
    const lastTradeRow = await this.tradeRepository
      .createQueryBuilder("t")
      .select("MAX(t.match_time)", "lastAt")
      .getRawOne<{ lastAt: Date | null }>();

    const lastAt = lastTradeRow?.lastAt ?? null;
    const lastTradeAgoSec =
      lastAt !== null ? Math.floor((Date.now() - lastAt.getTime()) / 1000) : null;

    await ctx.reply(
      formatWsStatusMessage({
        connected: this.wsStatusService.isConnected(),
        lastTradeAt: lastAt,
        lastTradeAgoSec,
        subscribedAssets: this.wsStatusService.getSubscribedAssets(),
        reconnectsLast24h: this.wsStatusService.getReconnectsLast24h(),
      }),
      { parse_mode: "HTML" },
    );
  }
}
