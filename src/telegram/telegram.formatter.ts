import { Market } from "../markets/market.entity.js";
import { Wallet } from "../wallets/wallet.entity.js";
import type { SmartWalletStats, SmartWalletDetail } from "../wallets/smart-wallets.service.js";

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

      return `${outcome} ${price.toFixed(2)}`;
    })
    .filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" / ");
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
    "/market &lt;slug&gt; — инфо по маркету",
    "/top — топ по объёму (все киты)",
    "/stats — статистика системы",
    "/alerts [on|off] — глобально вкл/выкл TG-алерты",
    "/queues — статус очередей BullMQ",
    "/errors — последние ошибки джобов",
    "/ws — статус WS подключения",
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

export function formatTopWalletsMessage(wallets: Wallet[]): string {
  const lines = ["\u{1F3C6} \u0422\u043E\u043F \u043A\u043E\u0448\u0435\u043B\u044C\u043A\u043E\u0432:", ""];

  for (const [index, wallet] of wallets.entries()) {
    const winRate = Math.round(Number(wallet.win_rate) * 100);
    lines.push(
      `${index + 1}. ${formatWalletAddress(wallet.address)} — win rate ${winRate}%, won $${formatCurrency(Number(wallet.total_won))}`,
    );
  }

  return lines.join("\n");
}

/** HTML parse_mode: <a href="..."> вместо Markdown. */
export function formatTopWhalesMessage(
  whales: Array<{ address: string; totalVolume: string; tradeCount: number }>,
): string {
  const lines = ["\u{1F40B} <b>Топ-10 китов по объёму:</b>", ""];

  for (const [index, whale] of whales.entries()) {
    const volume = formatCurrency(Number(whale.totalVolume));
    const polymarketUrl = `https://polymarket.com/profile/${whale.address}`;
    const addr = escapeHtml(formatWalletAddress(whale.address));
    lines.push(
      `${index + 1}. <a href="${polymarketUrl}">${addr}</a> — $${volume} (${whale.tradeCount} trades)`,
    );
  }

  if (whales.length === 0) {
    lines.push("Нет данных");
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
