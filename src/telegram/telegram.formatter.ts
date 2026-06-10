import { Market } from "../markets/market.entity.js";
import type {
  MarketScore,
  MarketScoreConclusionCode,
  MarketScoreDataGapCode,
  MarketScoreReason,
  WalletPnlV2Summary,
  WalletScoreSpecialization,
} from "../types/contracts.js";
import type { SmartWalletStats, SmartWalletDetail } from "../wallets/smart-wallets.service.js";
import type { WalletScore } from "../wallets/wallet-score.entity.js";

interface MarketTokenLike {
  outcome?: unknown;
  price?: unknown;
}

function asMarketTokens(tokens: unknown): MarketTokenLike[] {
  return Array.isArray(tokens) ? tokens.filter((token) => typeof token === "object" && token !== null) : [];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

function formatOdds(tokens: MarketTokenLike[]): string | null {
  const parts = tokens
    .map((token) => {
      const outcome = typeof token.outcome === "string" ? token.outcome.trim() : "";
      const rawPrice = token.price;
      const price = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? Number(rawPrice) : null;
      if (outcome.length === 0 || price === null || !Number.isFinite(price)) {
        return null;
      }

      return `${outcome} ${formatProbability(price)}`;
    })
    .filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" / ");
}

function formatProbability(price: number): string {
  const percent = price * 100;
  return `${percent >= 1 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatWalletAddress(address: string): string {
  const normalized = address.trim();
  if (normalized.length <= 10) {
    return normalized;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

/** Экранирование символов для HTML parse_mode в Telegram. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatStartMessage(): string {
  return [
    "Polychotam Smart Whale Tracker",
    "",
    "Команды:",
    "/whales — smart whale whitelist",
    "/whale &lt;addr&gt; — детали кошелька",
    "/pnl &lt;addr&gt; [days] — on-chain P&amp;L (30d/90d/all)",
    "/market &lt;slug&gt; — инфо по маркету",
    "/score &lt;slug-or-id&gt; — оценка рынка",
    "/top — топ по skill score",
    "/stats — статистика системы",
  ].join("\n");
}

export function formatAlertsStatusMessage(enabled: boolean): string {
  return enabled
    ? "Алерты smart whale включены."
    : "Алерты smart whale выключены.";
}

export function formatMarketMessage(market: Market): string {
  const tokens = asMarketTokens(market.tokens);
  const odds = formatOdds(tokens);
  const lines = [`\u{1F4CA} ${market.question}`];

  if (odds !== null) {
    lines.push(`Odds: ${odds}`);
  }

  lines.push(`Volume 24h: $${formatCurrency(market.volume24hr)}`);

  if (market.end_date_iso !== null) {
    lines.push(`Closes: ${market.end_date_iso.slice(0, 10)}`);
  }

  return lines.join("\n");
}

export function formatMarketScoreMessage(market: Market, score: MarketScore): string {
  const odds = formatOdds(asMarketTokens(market.tokens));
  const lines = [
    `\u{1F3AF} ${market.question}`,
    `Score: ${score.score}/100`,
  ];

  if (odds !== null) {
    lines.push(`Odds: ${odds}`);
  }

  lines.push(formatMarketScoreConclusion(score.conclusion), "", "Причины:");

  if (score.reasons.length === 0) {
    lines.push("- сильных причин пока нет");
  } else {
    for (const reason of score.reasons) {
      lines.push(`- ${formatMarketScoreReason(reason)}`);
    }
  }

  if (score.dataGaps.length > 0) {
    lines.push("", "Чего не хватает:");
    for (const gap of score.dataGaps) {
      lines.push(`- ${formatMarketScoreDataGap(gap)}`);
    }
  }

  lines.push("", `Slug: ${market.market_slug}`, `Condition id: ${market.condition_id}`);

  return lines.join("\n");
}

function formatMarketScoreConclusion(conclusion: MarketScoreConclusionCode): string {
  switch (conclusion) {
    case "insufficient_data":
      return "Недостаточно данных для уверенной оценки";
    case "strong_watch":
      return "Сильный рынок для наблюдения";
    case "medium_watch":
      return "Средний рынок: есть сигналы, но нужны проверки";
    case "weak_signal":
      return "Слабый рынок: сигналы пока неубедительны";
  }
}

function formatMarketScoreReason(reason: MarketScoreReason): string {
  switch (reason.code) {
    case "tradable_status":
      return "Статус: рынок открыт и принимает активность";
    case "not_tradable_status":
      return "Статус: рынок закрыт, неактивен или не принимает ордера";
    case "valid_prices":
      return "Цены: есть валидные цены исходов для сравнения";
    case "high_volume24hr":
      return `Объём: 24h volume около $${formatCurrency(Math.round(reason.value ?? 0))}`;
    case "some_volume24hr":
      return "Объём: есть ненулевой 24h volume, но он не выглядит сильным";
    case "high_liquidity":
      return `Ликвидность: liquidity около $${formatCurrency(Math.round(reason.value ?? 0))}`;
    case "some_liquidity":
      return "Ликвидность: ликвидность есть, но запас небольшой";
  }
}

function formatMarketScoreDataGap(gap: MarketScoreDataGapCode): string {
  switch (gap) {
    case "not_tradable":
      return "рынок закрыт, неактивен или не принимает ордера";
    case "missing_prices":
      return "нет валидных цен исходов";
    case "missing_volume24hr":
      return "нет заметного объёма 24h";
    case "missing_liquidity":
      return "нет заметной ликвидности";
    case "missing_end_date":
      return "нет даты закрытия";
  }
}

export function formatMarketScoreChoicesMessage(markets: Market[]): string {
  const lines = [
    "\u{1F50E} Выбери рынок для оценки:",
    "",
  ];

  for (const [index, market] of markets.entries()) {
    lines.push(
      `${index + 1}. ${truncateText(market.question, 78)}`,
      `   Volume 24h: $${formatCurrency(market.volume24hr)} | slug: ${market.market_slug}`,
      `   Оценить: /score ${index + 1} или /score ${market.market_slug}`,
    );
  }

  lines.push("", "Можно также отправить /score <slug-or-condition_id>.");

  return lines.join("\n");
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

/** Форматирует PnL v2 (on-chain cash-flow) для вывода в Telegram. */
export function formatWalletPnlV2Message(summary: WalletPnlV2Summary): string {
  const addr = escapeHtml(formatWalletAddress(summary.address));
  const total = formatSignedCurrency(summary.totalPnl);
  const realized = formatSignedCurrency(summary.realizedPnl);
  const open = formatSignedCurrency(summary.openPositionsValue);
  const updatedLine = formatUpdatedAgo(summary.computedAt);

  return [
    `\u{1F4CA} <b>Wallet P&amp;L</b>`,
    `Wallet: ${addr}`,
    `Period: ${escapeHtml(summary.window)}`,
    `Total P&amp;L: ${total}`,
    `  Realized: ${realized}`,
    `  Open positions: ${open}`,
    `est. on-chain data · ${updatedLine}`,
  ].join("\n");
}

/**
 * Возвращает строку «обновлено N мин назад» или «только что»
 * на основании ISO-строки computedAt.
 */
function formatUpdatedAgo(computedAt: string): string {
  const diffMs = Date.now() - new Date(computedAt).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return "обновлено только что";
  }
  return `обновлено ${diffMin} мин назад`;
}

function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${formatCurrency(Math.abs(value))}`;
}

/**
 * Определяет человекочитаемую специализацию кошелька:
 * категория с наибольшим resolvedCount, или Mixed если другой/равные.
 */
function formatSpecialization(spec: WalletScoreSpecialization): string {
  const categories = ["politics", "sports", "crypto", "other"] as const;

  let best: (typeof categories)[number] | null = null;
  let bestCount = 0;
  let hasTie = false;

  for (const cat of categories) {
    const count = spec[cat]?.resolvedCount ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = cat;
      hasTie = false;
    } else if (count === bestCount && bestCount > 0) {
      hasTie = true;
    }
  }

  if (best === null || hasTie || best === "other") {
    return "Mixed";
  }

  const labels: Record<"politics" | "sports" | "crypto", string> = {
    politics: "Politics",
    sports: "Sports",
    crypto: "Crypto",
  };

  return labels[best];
}

/** HTML parse_mode: форматирует топ умных кошельков из wallet_scores. */
export function formatTopSmartWalletsMessage(wallets: WalletScore[]): string {
  const lines = ["\u{1F9E0} <b>Топ Smart Wallets:</b>", ""];

  if (wallets.length === 0) {
    lines.push("Рейтинг пока пуст: накапливаем данные для честного скоринга");
    return lines.join("\n");
  }

  for (const [index, wallet] of wallets.entries()) {
    // encodeURIComponent: адрес приходит из БД, в href он не должен ломать HTML/URL
    const polymarketUrl = `https://polymarket.com/profile/${encodeURIComponent(wallet.address)}`;
    const addr = escapeHtml(formatWalletAddress(wallet.address));
    const pnl = wallet.pnl_90d !== null ? formatSignedCurrency(Number(wallet.pnl_90d)) : "n/a";
    const winRate = wallet.win_rate !== null ? `${(Number(wallet.win_rate) * 100).toFixed(1)}%` : "n/a";
    const spec = formatSpecialization(wallet.specialization);
    lines.push(
      `${index + 1}. <a href="${polymarketUrl}">${addr}</a> — PnL 90d: ${pnl} | WR: ${winRate} | ${escapeHtml(spec)} | ${wallet.sample_size} сделок`,
    );
  }

  return lines.join("\n");
}

/** Поля сделки для текста TG-алерта smart whale. */
export interface SmartWhaleAlertInput {
  address: string;
  side: string;
}

/** HR в алерте: в БД как доля 0–1 → проценты с одним знаком. */
function formatAlertHitRatePercent(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return null;
  }
  return `${(Number(raw) * 100).toFixed(1)}%`;
}

/** ROI в алерте: в БД уже в процентах. */
function formatAlertRoiPercent(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return null;
  }
  return `${Number(raw).toFixed(2)}%`;
}

export function formatSmartWhaleAlertMessage(
  input: SmartWhaleAlertInput,
  stats: SmartWalletStats | null,
  marketLabel: string,
  amount: number,
): string {
  const hr =
    stats !== null ? formatAlertHitRatePercent(stats.hit_rate) ?? "n/a" : "n/a";
  const roi =
    stats !== null ? formatAlertRoiPercent(stats.roi_pct) ?? "n/a" : "n/a";
  const whaleTrades =
    stats !== null ? String(stats.whale_trade_count) : "n/a";

  return [
    "\u{1F6A8} Smart Whale Trade!",
    `Wallet: ${input.address}`,
    `Market: ${marketLabel}`,
    `Side: ${input.side}`,
    `Size: $${Math.round(amount).toLocaleString("en-US")}`,
    `HR: ${hr}`,
    `ROI: ${roi}`,
    `Whale trades: ${whaleTrades}`,
  ].join("\n");
}

export function formatSmartWhalesListMessage(wallets: SmartWalletStats[]): string {
  const lines = ["\u{1F9E0} <b>Smart Whale Whitelist:</b>", ""];

  for (const [index, w] of wallets.entries()) {
    const hr = w.hit_rate ? `${(Number(w.hit_rate) * 100).toFixed(0)}%` : "?";
    const pnl = w.sum_pnl ? `$${formatCurrency(Number(w.sum_pnl))}` : "?";
    const roi = w.roi_pct ? `${Number(w.roi_pct).toFixed(1)}%` : "?";
    const addr = escapeHtml(formatWalletAddress(w.address));
    const url = `https://polymarket.com/profile/${w.address}`;

    lines.push(
      `${index + 1}. <a href="${url}">${addr}</a>`,
    );
    lines.push(
      `   HR: ${hr} | PnL: ${pnl} | ROI: ${roi} | ${w.whale_trade_count} trades`,
    );
  }

  return lines.join("\n");
}

export function formatSmartWhaleDetailMessage(detail: SmartWalletDetail): string {
  const addr = detail.address;
  const url = `https://polymarket.com/profile/${addr}`;
  const hr = detail.hit_rate ? `${(Number(detail.hit_rate) * 100).toFixed(1)}%` : "n/a";
  const pnl = detail.sum_pnl ? `$${formatCurrency(Number(detail.sum_pnl))}` : "n/a";
  const roi = detail.roi_pct ? `${Number(detail.roi_pct).toFixed(2)}%` : "n/a";
  const addrShort = escapeHtml(formatWalletAddress(addr));

  const lines = [
    `\u{1F9E0} <a href="${url}">${addrShort}</a>`,
    "",
    `Hit Rate: ${hr}`,
    `Sum PnL: ${pnl}`,
    `ROI: ${roi}`,
    `Whale trades: ${detail.whale_trade_count}`,
    `Source: ${escapeHtml(detail.source)}`,
    detail.notes ? `Notes: ${escapeHtml(detail.notes)}` : "",
    "",
    "<b>Last 10 trades:</b>",
  ];

  for (const t of detail.recentTrades) {
    const pnlStr = t.pnl !== null ? ` (${t.pnl > 0 ? "+" : ""}$${Math.round(t.pnl)})` : "";
    const question = t.market_question.length > 40
      ? `${t.market_question.slice(0, 37)}...`
      : t.market_question;
    lines.push(`  ${escapeHtml(t.side)} $${formatCurrency(Number(t.size) * Number(t.price))}${pnlStr} — ${escapeHtml(question)}`);
  }

  if (detail.recentTrades.length === 0) {
    lines.push("  (нет сделок в БД)");
  }

  return lines.filter((l) => l !== "").join("\n");
}

function formatDurationMs(ms: number): string {
  if (ms <= 0) {
    return "0m";
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins}m`);
  }
  return parts.join(" ");
}

export function formatStatsMessage(stats: {
  tradesTotal: number;
  trades24h: number;
  marketsTotal: number;
  marketsResolved: number;
  smartWhalesActive: number;
  wsConnectedForMs: number;
  wsUptimeRatio24h: number;
}): string {
  return [
    "\u{1F4C8} System Stats",
    "",
    `Trades total: ${formatCurrency(stats.tradesTotal)}`,
    `Trades 24h: ${formatCurrency(stats.trades24h)}`,
    `Markets tracked: ${formatCurrency(stats.marketsTotal)}`,
    `Markets resolved: ${formatCurrency(stats.marketsResolved)}`,
    `Smart whales active: ${stats.smartWhalesActive}`,
    `WS connected for: ${formatDurationMs(stats.wsConnectedForMs)}`,
    `WS uptime (24h): ${(stats.wsUptimeRatio24h * 100).toFixed(1)}%`,
  ].join("\n");
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export function formatQueuesMessage(queues: QueueStats[]): string {
  const lines = ["\u{2699}\u{FE0F} <b>BullMQ Queues:</b>", ""];

  for (const q of queues) {
    const failedMark = q.failed > 0 ? " \u{26A0}\u{FE0F}" : "";
    lines.push(`<b>${escapeHtml(q.name)}</b>${failedMark}`);
    lines.push(
      `  waiting: ${q.waiting} | active: ${q.active} | delayed: ${q.delayed}`,
    );
    lines.push(`  completed: ${formatCurrency(q.completed)} | failed: ${q.failed}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export interface ErrorEntry {
  ts: string;
  queue?: string;
  jobName?: string;
  message?: string;
  eventType?: string;
}

export function formatErrorsMessage(errors: ErrorEntry[], totalCount: number): string {
  if (errors.length === 0) {
    return "\u{2705} Ошибок джобов нет (NDJSON пуст)";
  }

  const lines = [
    `\u{1F6A8} <b>Последние ошибки джобов</b> (показано ${errors.length} из ${totalCount}):`,
    "",
  ];

  for (const e of errors) {
    const time = e.ts.slice(11, 19);
    const queue = e.queue ?? "?";
    const job = e.jobName ?? "?";
    const event = e.eventType ?? "?";
    const msg = (e.message ?? "?").slice(0, 200);
    lines.push(`<code>${time}</code> [${escapeHtml(queue)}] ${escapeHtml(job)} <i>${escapeHtml(event)}</i>`);
    lines.push(`  ${escapeHtml(msg)}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export interface WsStatusInfo {
  connected: boolean;
  lastTradeAt: Date | null;
  lastTradeAgoSec: number | null;
  subscribedAssets: number;
  reconnectsLast24h: number;
}

export function formatWsStatusMessage(s: WsStatusInfo): string {
  const status = s.connected ? "\u{1F7E2} connected" : "\u{1F534} disconnected";
  const lastTrade = s.lastTradeAt
    ? `${s.lastTradeAt.toISOString().slice(0, 19).replace("T", " ")} UTC (${formatAgo(s.lastTradeAgoSec)})`
    : "\u2014";

  return [
    `\u{1F4E1} <b>WebSocket status:</b> ${status}`,
    "",
    `Last trade in DB: ${escapeHtml(lastTrade)}`,
    `Subscribed assets: ${s.subscribedAssets}`,
    `Reconnects (24h): ${s.reconnectsLast24h}`,
  ].join("\n");
}

function formatAgo(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "?";
  }
  if (seconds < 60) {
    return `${Math.floor(seconds)}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}
