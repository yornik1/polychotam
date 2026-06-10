import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Ctx, Command, Start, Update } from "nestjs-telegraf";
import { MarketScoreService } from "../markets/market-score.service.js";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { WalletScoreService } from "../wallets/wallet-score.service.js";
import { WalletPnlV2Service } from "../wallets/wallet-pnl-v2.service.js";
import type { WalletPnlV2Window } from "../types/contracts.js";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { QueueStatsService } from "../queue/queue-stats.service.js";
import { PolymarketWsStatusService } from "../polymarket/polymarket-ws-status.service.js";
import { AlertSettingsService } from "../settings/alert-settings.service.js";
import { WsUptimeService } from "../polymarket/ws-uptime.service.js";
import { isAdminChat } from "./admin-guard.util.js";
import { TelegramService } from "./telegram.service.js";
import {
  formatAlertsStatusMessage,
  formatErrorsMessage,
  formatMarketMessage,
  formatMarketScoreChoicesMessage,
  formatMarketScoreMessage,
  formatQueuesMessage,
  formatSmartWhaleDetailMessage,
  formatSmartWhalesListMessage,
  formatStartMessage,
  formatStatsMessage,
  formatTopSmartWalletsMessage,
  formatWalletPnlV2Message,
  formatWsStatusMessage,
} from "./telegram.formatter.js";

interface ReplyContext {
  payload?: string;
  chat?: { id: number };
  reply(message: string, extra?: unknown): Promise<unknown> | unknown;
}

const SCORE_CHOICES_LIMIT = 5;
const SCORE_CHOICE_PATTERN = /^[1-9]\d*$/u;

/**
 * Преобразует число дней из аргумента /pnl в окно v2.
 * ≤30 → "30d", ≤90 → "90d", иначе/без аргумента → "all".
 */
function resolvePnlV2Window(daysRaw: string | undefined): WalletPnlV2Window {
  const days = Number(daysRaw);
  if (!Number.isFinite(days) || days <= 0) {
    return "all";
  }
  if (days <= 30) {
    return "30d";
  }
  if (days <= 90) {
    return "90d";
  }
  return "all";
}

@Injectable()
@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    private readonly marketsService: MarketsService,
    private readonly marketScoreService: MarketScoreService,
    private readonly smartWalletsService: SmartWalletsService,
    private readonly queueStatsService: QueueStatsService,
    private readonly wsStatusService: PolymarketWsStatusService,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    private readonly alertSettingsService: AlertSettingsService,
    private readonly wsUptimeService: WsUptimeService,
    private readonly configService: ConfigService,
    private readonly walletScoreService: WalletScoreService,
    private readonly telegramService: TelegramService,
    private readonly walletPnlV2Service: WalletPnlV2Service,
  ) {
    this.adminChatId = this.configService.getOrThrow<string>("ADMIN_CHAT_ID");
  }

  private readonly adminChatId: string;

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

  @Command("score")
  async handleScore(@Ctx() ctx: ReplyContext): Promise<void> {
    const marketKey = ctx.payload?.trim() ?? "";
    if (marketKey.length === 0) {
      await this.replyWithScoreChoices(ctx);
      return;
    }

    try {
      const resolvedMarketKey = await this.resolveScoreMarketKey(marketKey);
      if (resolvedMarketKey === null) {
        await ctx.reply("Не вижу рынка под таким номером. Вызови /score и выбери номер из списка.");
        return;
      }

      const market = await this.findMarketForScore(resolvedMarketKey);
      if (market === null) {
        await ctx.reply("Маркет не найден. Попробуй другой slug или condition id.");
        return;
      }

      await ctx.reply(formatMarketScoreMessage(market, this.marketScoreService.scoreMarket(market)));
    } catch (error: unknown) {
      this.logger.warn(`Не удалось оценить рынок в Telegram: ${this.toErrorMessage(error)}`);
      await ctx.reply("Не удалось оценить рынок. Попробуй позже.");
    }
  }

  private async replyWithScoreChoices(ctx: ReplyContext): Promise<void> {
    try {
      const markets = await this.marketsService.getScoreCandidates(SCORE_CHOICES_LIMIT);
      if (markets.length === 0) {
        await ctx.reply("Пока нет рынков для выбора. Попробуй /score <slug-or-condition_id>.");
        return;
      }

      await ctx.reply(formatMarketScoreChoicesMessage(markets));
    } catch (error: unknown) {
      this.logger.warn(`Не удалось получить рынки для Telegram score chooser: ${this.toErrorMessage(error)}`);
      await ctx.reply("Не удалось получить список рынков. Попробуй /score <slug-or-condition_id>.");
    }
  }

  @Command("top")
  async handleTop(@Ctx() ctx: ReplyContext): Promise<void> {
    const wallets = await this.walletScoreService.getTopByScore(10);

    // При пуле < 10 шлём admin-алерт (fire-and-forget)
    if (wallets.length < 10) {
      this.telegramService
        .sendAdminAlert(`мало кандидатов в /top: ${wallets.length}`)
        .catch((err: unknown) => {
          this.logger.warn(
            `Не удалось отправить admin alert для /top: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    await ctx.reply(formatTopSmartWalletsMessage(wallets), {
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

  @Command("pnl")
  async handlePnl(@Ctx() ctx: ReplyContext): Promise<void> {
    const raw = ctx.payload?.trim() ?? "";
    if (raw.length === 0) {
      await ctx.reply("Укажи адрес: /pnl <0xADDR> [days]");
      return;
    }

    const [addressRaw, daysRaw] = raw.split(/\s+/u);
    const address = addressRaw?.trim() ?? "";
    if (address.length === 0) {
      await ctx.reply("Укажи адрес: /pnl <0xADDR> [days]");
      return;
    }

    const window = resolvePnlV2Window(daysRaw);
    const summary = await this.walletPnlV2Service.getOrComputePnl(address, window);

    await ctx.reply(formatWalletPnlV2Message(summary), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  @Command("alerts")
  async handleAlerts(@Ctx() ctx: ReplyContext): Promise<void> {
    if (!isAdminChat(ctx.chat?.id, this.adminChatId)) return;
    const raw = ctx.payload?.trim() ?? "";
    const arg = raw.toLowerCase();

    if (arg === "off") {
      await this.alertSettingsService.setAlertsEnabled(false);
      await ctx.reply(formatAlertsStatusMessage(false));
      return;
    }

    if (arg === "on") {
      await this.alertSettingsService.setAlertsEnabled(true);
      await ctx.reply(formatAlertsStatusMessage(true));
      return;
    }

    const enabled = await this.alertSettingsService.isAlertsEnabled();
    await ctx.reply(formatAlertsStatusMessage(enabled));
  }

  @Command("stats")
  async handleStats(@Ctx() ctx: ReplyContext): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      tradesCount,
      marketsCount,
      resolvedCount,
      smartCount,
      wsUptimeRatio24h,
      recentTrades,
    ] = await Promise.all([
      this.tradeRepository.count(),
      this.marketRepository.count(),
      this.marketRepository.count({
        where: { closed: true },
      }),
      this.smartWalletsService.getActiveWhitelist().then((l) => l.length),
      this.wsUptimeService.getUptimeRatio24h(),
      this.tradeRepository
        .createQueryBuilder("t")
        .where("t.match_time >= :since", { since })
        .getCount(),
    ]);

    const wsConnectedForMs = this.wsUptimeService.getElapsedMs();

    await ctx.reply(
      formatStatsMessage({
        tradesTotal: tradesCount,
        trades24h: recentTrades,
        marketsTotal: marketsCount,
        marketsResolved: resolvedCount,
        smartWhalesActive: smartCount,
        wsConnectedForMs,
        wsUptimeRatio24h,
      }),
    );
  }

  @Command("queues")
  async handleQueues(@Ctx() ctx: ReplyContext): Promise<void> {
    if (!isAdminChat(ctx.chat?.id, this.adminChatId)) return;
    const counts = await this.queueStatsService.getAllQueueCounts();
    await ctx.reply(formatQueuesMessage(counts), { parse_mode: "HTML" });
  }

  @Command("errors")
  async handleErrors(@Ctx() ctx: ReplyContext): Promise<void> {
    if (!isAdminChat(ctx.chat?.id, this.adminChatId)) return;
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
    if (!isAdminChat(ctx.chat?.id, this.adminChatId)) return;
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

  private async findMarketForScore(marketKey: string): Promise<Market | null> {
    const bySlug = await this.marketsService.findBySlug(marketKey);
    if (bySlug !== null) {
      return bySlug;
    }

    return this.marketsService.findByConditionId(marketKey);
  }

  private async resolveScoreMarketKey(marketKey: string): Promise<string | null> {
    if (!SCORE_CHOICE_PATTERN.test(marketKey)) {
      return marketKey;
    }

    const scoreCandidates = await this.marketsService.getScoreCandidates(SCORE_CHOICES_LIMIT);
    return scoreCandidates[Number(marketKey) - 1]?.market_slug ?? null;
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "неизвестная ошибка";
  }
}
