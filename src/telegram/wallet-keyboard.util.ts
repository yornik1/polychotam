import type { SmartWalletStats } from "../wallets/smart-wallets.service.js";
import { formatCurrency, formatWalletAddress } from "./telegram.formatter.js";

/**
 * Чистые билдеры inline-клавиатур для /whales и карточки кошелька.
 * Возвращают plain-структуру кнопок (text + callback_data/url), которую
 * telegram.update оборачивает в reply_markup. Так логика тестируется без telegraf.
 */

/** Кнопка inline-клавиатуры: callback или url. */
export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type InlineKeyboard = InlineButton[][];

/** Префиксы callback_data (≤64 байт; адрес 42 символа влезает). */
export const CB_CARD = "w:"; // показать карточку кошелька
export const CB_FOLLOW = "f:"; // подписаться
export const CB_UNFOLLOW = "u:"; // отписаться
export const CB_PNL = "p:"; // показать PnL
export const CB_PAGE = "wp:"; // пагинация списка

/** Сколько кошельков на странице /whales. */
export const WHALES_PAGE_SIZE = 8;

/** Короткий лейбл кошелька для кнопки списка. */
function walletButtonLabel(index: number, w: SmartWalletStats): string {
  const hr = w.hit_rate ? `${(Number(w.hit_rate) * 100).toFixed(0)}%` : "?";
  const pnl = w.sum_pnl ? `$${formatCurrency(Number(w.sum_pnl))}` : "?";
  return `${index + 1}. ${formatWalletAddress(w.address)} · HR${hr} · ${pnl}`;
}

/**
 * Список кошельков как inline-клавиатура с пагинацией.
 * Возвращает только клавиатуру; текст сообщения формируется отдельно.
 */
export function buildWhalesKeyboard(
  wallets: readonly SmartWalletStats[],
  page = 0,
  pageSize = WHALES_PAGE_SIZE,
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(wallets.length / pageSize));
  const safePage = Math.min(Math.max(0, Math.floor(page)), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = wallets.slice(start, start + pageSize);

  const keyboard: InlineKeyboard = pageItems.map((w, i) => [
    { text: walletButtonLabel(start + i, w), callback_data: `${CB_CARD}${w.address}` },
  ]);

  // Ряд пагинации только если страниц больше одной
  if (totalPages > 1) {
    const nav: InlineButton[] = [];
    if (safePage > 0) {
      nav.push({ text: "⬅️", callback_data: `${CB_PAGE}${safePage - 1}` });
    }
    nav.push({ text: `${safePage + 1}/${totalPages}`, callback_data: `${CB_PAGE}${safePage}` });
    if (safePage < totalPages - 1) {
      nav.push({ text: "➡️", callback_data: `${CB_PAGE}${safePage + 1}` });
    }
    keyboard.push(nav);
  }

  return keyboard;
}

/**
 * Клавиатура карточки кошелька: toggle подписки + PnL + ссылка на Polymarket.
 */
export function buildWalletCardKeyboard(address: string, isFollowed: boolean): InlineKeyboard {
  const followBtn: InlineButton = isFollowed
    ? { text: "🔕 Не следить", callback_data: `${CB_UNFOLLOW}${address}` }
    : { text: "🔔 Следить", callback_data: `${CB_FOLLOW}${address}` };

  return [
    [followBtn, { text: "📊 PnL", callback_data: `${CB_PNL}${address}` }],
    [{ text: "🌐 Polymarket", url: `https://polymarket.com/profile/${address}` }],
  ];
}
