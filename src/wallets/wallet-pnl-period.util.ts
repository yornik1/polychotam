export const DEFAULT_WALLET_PNL_DAYS = 30;
export const MAX_WALLET_PNL_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WalletPnlResolvedPeriod {
  days: number;
  from: Date;
}

export function parseWalletPnlDays(daysRaw: string | undefined): number {
  if (daysRaw === undefined) {
    return DEFAULT_WALLET_PNL_DAYS;
  }

  const days = Number(daysRaw);
  if (!Number.isSafeInteger(days) || days <= 0) {
    return DEFAULT_WALLET_PNL_DAYS;
  }

  return Math.min(days, MAX_WALLET_PNL_DAYS);
}

export function resolveWalletPnlPeriod(daysRaw: string | undefined): WalletPnlResolvedPeriod {
  const days = parseWalletPnlDays(daysRaw);
  return {
    days,
    from: new Date(Date.now() - days * DAY_MS),
  };
}
