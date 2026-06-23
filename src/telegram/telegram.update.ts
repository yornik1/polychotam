import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Ctx, Command, Start, Action, Update } from "nestjs-telegraf";
import { MarketScoreService } from "../markets/market-score.service.js";
import { MarketsService } from "../markets/markets.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { WalletScoreService } from "../wallets/wallet-score.service.js";
import { WalletPnlV2Service } from "../wallets/wallet-pnl-v2.service.js";
import { CandidateDiscoveryService } from "../wallets/candidate-discovery.service.js";
import { FollowedWalletsService } from "../wallets/followed-wallets.service.js";
import {
  buildWalletCardKeyboard,
  buildWhalesKeyboard,
  type InlineKeyboard,
} from "./wallet-keyboard.util.js";
import type { WalletPnlV2Window } from "../types/contracts.js";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Trade } from "../trades/trade.entity.js";
import { Market } from "../markets/market.entity.js";
import { QueueStatsService } from "../queue/queue-stats.service.js";
import { PolymarketWsStatusService } from "../polymarket/polymarket-ws-status.service.js";
import { WsUptimeService } from "../polymarket/ws-uptime.service.js";
import { isAdminChat } from "./admin-guard.util.js";
import { TelegramService } from "./telegram.service.js";
import {
  formatErrorsMessage,
  formatMarketMessage,
  formatMarketScoreChoicesMessage,
  formatMarketScoreMessage,
  formatQueuesMessage,
  formatSmartWhaleDetailMessage,
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

/** Контекст callback-запроса (нажатие inline-кнопки). */
interface CallbackContext {
  /** Отправитель callback — для admin-guard (callback идёт по from.id, не chat.id). */
  from?: { id: number };
  /** Результат regex из @Action — match[1] содержит адрес. */
  match?: RegExpExecArray | null;
  answerCbQuery(text?: string): Promise<unknown> | unknown;
  editMessageText(text: string, extra?: unknown): Promise<unknown> | unknown;
  reply(message: string, extra?: unknown): Promise<unknown> | unknown;
}

/** Telegram-extra с inline-клавиатурой. */
function inlineKeyboardExtra(keyboard: InlineKeyboard): Record<string, unknown> {
  return {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  };
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
    private readonly wsUptimeService: WsUptimeService,
    private readonly configService: ConfigService,
    private readonly walletScoreService: WalletScoreService,
    private readonly telegramService: TelegramService,
    private readonly walletPnlV2Service: WalletPnlV2Service,
    private readonly candidateDiscoveryService: CandidateDiscoveryService,
    private readonly followedWalletsService: FollowedWalletsService,
  ) {
    // Приоритет: ADMIN_CHAT_ID → TELEGRAM_CHAT_ID → null (admin-функции отключены)
    const raw =
      this.configService.get<string>("ADMIN_CHAT_ID")?.trim() ||
      this.configService.get<string>("TELEGRAM_CHAT_ID")?.trim() ||
      null;
    this.adminChatId = raw !== null && raw.length > 0 ? raw : null;
  }

  private readonly adminChatId: string | null;

  @Start()
  async handleStart(@Ctx() ctx: ReplyContext): Promise<void> {
    await ctx.reply(formatStartMessage(), { parse_mode: "HTML" });
  }

  /**
   * Admin-команда: запустить дискавери кандидатов немедленно (не ждать 6h-крон).
   * Краулит холдеров топ-рынков → discovered, затем скорит и промоутит прошедших гейты.
   */
  @Command("discover")
  async handleDiscover(@Ctx() ctx: ReplyContext): Promise<void> {
    if (!isAdminChat(ctx.chat?.id, this.adminChatId)) return;

    await ctx.reply("🔎 Запускаю дискавери кандидатов… (краулинг холдеров + скоринг)");
    try {
      const discovery = await this.candidateDiscoveryService.discoverFromTopMarkets();
      const promote = await this.candidateDiscoveryService.scoreAndPromoteDiscovered();
      await ctx.reply(
        [
          "✅ Дискавери завершён",
          `Рынков просканировано: ${discovery.marketsScanned}`,
          `Найдено адресов: ${discovery.addressesFound}`,
          `Новых кандидатов: ${discovery.inserted} (уже было: ${discovery.skippedExisting})`,
          `Оценено: ${promote.evaluated} · промоутнуто: ${promote.promoted} · отклонено: ${promote.rejected} · ошибок: ${promote.failed}`,
          "",
          "Промоутнутые видны в /whales.",
        ].join("\n"),
      );
    } catch (error: unknown) {
      await ctx.reply(`⚠️ Дискавери упал: ${this.toErrorMessage(error)}`);
    }
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
    // Список — inline-кнопки: тап открывает карточку (адрес в callback_data, без копипасты).
    const keyboard = buildWhalesKeyboard(whitelist);
    await ctx.reply(
      "🧠 <b>Smart-кошельки</b> — тапни кошелёк для карточки и подписки:",
      inlineKeyboardExtra(keyboard),
    );
  }

  /** Список кошельков, на которые подписан пользователь. */
  @Command("following")
  async handleFollowing(@Ctx() ctx: ReplyContext): Promise<void> {
    const addresses = await this.followedWalletsService.list();
    if (addresses.length === 0) {
      await ctx.reply("Ты пока ни за кем не следишь. Открой /whales и нажми 🔔 Следить.");
      return;
    }
    const lines = ["🔔 <b>Слежу за:</b>", ""];
    for (const [i, addr] of addresses.entries()) {
      const url = `https://polymarket.com/profile/${addr}`;
      lines.push(`${i + 1}. <a href="${url}">${addr}</a>`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
  }

  /**
   * Admin-guard для callback'ов: бот личный, мутации (follow/unfollow) должны
   * идти только из admin-чата. Callback приходит по from.id, а не chat.id.
   */
  private async ensureCallbackAdmin(ctx: CallbackContext): Promise<boolean> {
    if (isAdminChat(ctx.from?.id, this.adminChatId)) {
      return true;
    }
    await ctx.answerCbQuery();
    return false;
  }

  /** Callback: пагинация списка /whales (перерисовка на месте). */
  @Action(/^wp:(\d+)$/u)
  async handleWhalesPage(@Ctx() ctx: CallbackContext): Promise<void> {
    if (!(await this.ensureCallbackAdmin(ctx))) return;
    const page = Number(ctx.match?.[1] ?? "0");
    const whitelist = await this.smartWalletsService.getActiveWhitelist();
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "🧠 <b>Smart-кошельки</b> — тапни кошелёк для карточки и подписки:",
      inlineKeyboardExtra(buildWhalesKeyboard(whitelist, page)),
    );
  }

  /** Callback: показать карточку кошелька (кнопка из /whales). */
  @Action(/^w:(.+)$/u)
  async handleWalletCard(@Ctx() ctx: CallbackContext): Promise<void> {
    if (!(await this.ensureCallbackAdmin(ctx))) return;
    const address = ctx.match?.[1]?.trim() ?? "";
    if (address.length === 0) {
      await ctx.answerCbQuery("Не удалось определить кошелёк");
      return;
    }
    await ctx.answerCbQuery();
    await this.renderWalletCard(ctx, address);
  }

  /** Callback: подписаться на кошелёк. */
  @Action(/^f:(.+)$/u)
  async handleFollow(@Ctx() ctx: CallbackContext): Promise<void> {
    if (!(await this.ensureCallbackAdmin(ctx))) return;
    const address = ctx.match?.[1]?.trim() ?? "";
    if (address.length === 0) {
      await ctx.answerCbQuery("Не удалось определить кошелёк");
      return;
    }
    await this.followedWalletsService.follow(address);
    await ctx.answerCbQuery("🔔 Теперь слежу за этим кошельком");
    await this.renderWalletCard(ctx, address);
  }

  /** Callback: отписаться от кошелька. */
  @Action(/^u:(.+)$/u)
  async handleUnfollow(@Ctx() ctx: CallbackContext): Promise<void> {
    if (!(await this.ensureCallbackAdmin(ctx))) return;
    const address = ctx.match?.[1]?.trim() ?? "";
    if (address.length === 0) {
      await ctx.answerCbQuery("Не удалось определить кошелёк");
      return;
    }
    await this.followedWalletsService.unfollow(address);
    await ctx.answerCbQuery("🔕 Больше не слежу");
    await this.renderWalletCard(ctx, address);
  }

  /** Callback: PnL кошелька (отдельным сообщением, карточка остаётся). */
  @Action(/^p:(.+)$/u)
  async handleCardPnl(@Ctx() ctx: CallbackContext): Promise<void> {
    if (!(await this.ensureCallbackAdmin(ctx))) return;
    const address = ctx.match?.[1]?.trim() ?? "";
    if (address.length === 0) {
      await ctx.answerCbQuery("Не удалось определить кошелёк");
      return;
    }
    await ctx.answerCbQuery();
    try {
      const summary = await this.walletPnlV2Service.getOrComputePnl(address, "all");
      await ctx.reply(formatWalletPnlV2Message(summary), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (error: unknown) {
      await ctx.reply(`Не удалось получить PnL: ${this.toErrorMessage(error)}`);
    }
  }

  /** Рендерит карточку кошелька с актуальной кнопкой подписки (edit на месте). */
  private async renderWalletCard(ctx: CallbackContext, address: string): Promise<void> {
    const detail = await this.smartWalletsService.getWalletDetail(address);
    const followed = await this.followedWalletsService.isFollowed(address);
    const keyboard = buildWalletCardKeyboard(address, followed);
    const text =
      detail !== null
        ? formatSmartWhaleDetailMessage(detail)
        : `Кошелёк <code>${address}</code> (нет метрик в whitelist).`;
    await ctx.editMessageText(text, inlineKeyboardExtra(keyboard));
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
    // Глобального on/off больше нет — алерты теперь per-wallet (подписки).
    await ctx.reply(
      "Алерты теперь по подписке на конкретные кошельки.\n" +
        "Открой /whales → тапни кошелёк → 🔔 Следить.\n" +
        "Кого слушаю: /following",
    );
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
