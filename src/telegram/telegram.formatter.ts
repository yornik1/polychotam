import { Market } from "../markets/market.entity.js";
import { Wallet } from "../wallets/wallet.entity.js";

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
  return "Polychotam запущен. Команды: /start, /top, /market <slug>.";
}

export function formatMarketMessage(market: Market): string {
  const tokens = asMarketTokens(market.tokens);
  const odds = formatOdds(tokens);
  const lines = [`📊 ${market.question}`];

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
  const lines = ["🏆 Топ кошельков:", ""];

  for (const [index, wallet] of wallets.entries()) {
    const winRate = Math.round(Number(wallet.win_rate) * 100);
    lines.push(
      `${index + 1}. ${formatWalletAddress(wallet.address)} — win rate ${winRate}%, won $${formatCurrency(Number(wallet.total_won))}`,
    );
  }

  return lines.join("\n");
}
