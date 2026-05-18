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

export function formatStartMessage(): string {
  return [
    "Polychotam Smart Whale Tracker",
    "",
    "Команды:",
    "/whales — smart whale whitelist",
    "/whale <addr> — детали кошелька",
    "/market <slug> — инфо по маркету",
    "/top — топ по объёму (все киты)",
    "/stats — статистика системы",
    "/alerts [on|off] — глобально вкл/выкл TG-алерты",
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

export function formatTopWhalesMessage(
  whales: Array<{ address: string; totalVolume: string; tradeCount: number }>,
): string {
  const lines = ["\u{1F40B} \u0422\u043E\u043F-10 \u043A\u0438\u0442\u043E\u0432 \u043F\u043E \u043E\u0431\u044A\u0451\u043C\u0443:", ""];

  for (const [index, whale] of whales.entries()) {
    const volume = formatCurrency(Number(whale.totalVolume));
    const polymarketUrl = `https://polymarket.com/profile/${whale.address}`;
    lines.push(
      `${index + 1}. [${formatWalletAddress(whale.address)}](${polymarketUrl}) — $${volume} (${whale.tradeCount} trades)`,
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

export function formatSmartWhaleAlertMessage(
  input: SmartWhaleAlertInput,
  stats: SmartWalletStats | null,
  marketLabel: string,
  amount: number,
): string {
  const hr =
    stats !== null &&
    stats.hit_rate !== null &&
    stats.hit_rate !== undefined &&
    String(stats.hit_rate).trim() !== ""
      ? `${(Number(stats.hit_rate) * 100).toFixed(1)}%`
      : "n/a";
  const roi =
    stats !== null &&
    stats.roi_pct !== null &&
    stats.roi_pct !== undefined &&
    String(stats.roi_pct).trim() !== ""
      ? `${Number(stats.roi_pct).toFixed(2)}%`
      : "n/a";
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
  const lines = ["\u{1F9E0} Smart Whale Whitelist:", ""];

  for (const [index, w] of wallets.entries()) {
    const hr = w.hit_rate ? `${(Number(w.hit_rate) * 100).toFixed(0)}%` : "?";
    const pnl = w.sum_pnl ? `$${formatCurrency(Number(w.sum_pnl))}` : "?";
    const roi = w.roi_pct ? `${Number(w.roi_pct).toFixed(1)}%` : "?";
    const addr = formatWalletAddress(w.address);
    const url = `https://polymarket.com/profile/${w.address}`;

    lines.push(
      `${index + 1}. [${addr}](${url})`,
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

  const lines = [
    `\u{1F9E0} [${formatWalletAddress(addr)}](${url})`,
    "",
    `Hit Rate: ${hr}`,
    `Sum PnL: ${pnl}`,
    `ROI: ${roi}`,
    `Whale trades: ${detail.whale_trade_count}`,
    `Source: ${detail.source}`,
    detail.notes ? `Notes: ${detail.notes}` : "",
    "",
    "Last 10 trades:",
  ];

  for (const t of detail.recentTrades) {
    const pnlStr = t.pnl !== null ? ` (${t.pnl > 0 ? "+" : ""}$${Math.round(t.pnl)})` : "";
    const question = t.market_question.length > 40
      ? `${t.market_question.slice(0, 37)}...`
      : t.market_question;
    lines.push(`  ${t.side} $${formatCurrency(Number(t.size) * Number(t.price))}${pnlStr} — ${question}`);
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
