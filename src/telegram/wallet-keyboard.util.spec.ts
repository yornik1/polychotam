import { describe, expect, it } from "vitest";
import type { SmartWalletStats } from "../wallets/smart-wallets.service.js";
import {
  buildWalletCardKeyboard,
  buildWhalesKeyboard,
  CB_CARD,
  CB_FOLLOW,
  CB_PAGE,
  CB_PNL,
  CB_UNFOLLOW,
} from "./wallet-keyboard.util.js";

function wallet(address: string, overrides: Partial<SmartWalletStats> = {}): SmartWalletStats {
  return {
    address,
    active: true,
    hit_rate: "0.8",
    sum_pnl: "1000",
    roi_pct: "36.4",
    whale_trade_count: 50,
    notes: "",
    source: "discovered",
    ...overrides,
  };
}

describe("buildWhalesKeyboard", () => {
  it("по кнопке на каждый кошелёк с callback_data w:<addr>", () => {
    const kb = buildWhalesKeyboard([wallet("0xaaa"), wallet("0xbbb")]);
    expect(kb).toHaveLength(2); // нет пагинации (1 страница)
    expect(kb[0]?.[0]).toMatchObject({ callback_data: `${CB_CARD}0xaaa` });
    expect(kb[1]?.[0]).toMatchObject({ callback_data: `${CB_CARD}0xbbb` });
  });

  it("callback_data укладывается в 64 байта (адрес 42 символа)", () => {
    const kb = buildWhalesKeyboard([wallet("0x" + "a".repeat(40))]);
    const btn = kb[0]?.[0];
    const data = btn && "callback_data" in btn ? btn.callback_data : "";
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("добавляет ряд пагинации при >pageSize кошельках", () => {
    const wallets = Array.from({ length: 20 }, (_, i) => wallet(`0x${i}`));
    const kb = buildWhalesKeyboard(wallets, 0, 8);
    expect(kb).toHaveLength(9); // 8 кошельков + ряд навигации
    const nav = kb[8]!;
    // на первой странице: нет ⬅️, есть индикатор и ➡️
    expect(nav.some((b) => "callback_data" in b && b.callback_data === `${CB_PAGE}1`)).toBe(true);
    expect(nav.some((b) => b.text === "⬅️")).toBe(false);
  });

  it("вторая страница показывает ⬅️ и корректный срез", () => {
    const wallets = Array.from({ length: 20 }, (_, i) => wallet(`0x${i}`));
    const kb = buildWhalesKeyboard(wallets, 1, 8);
    const firstBtn = kb[0]?.[0];
    expect(firstBtn).toMatchObject({ callback_data: `${CB_CARD}0x8` });
    const nav = kb[kb.length - 1]!;
    expect(nav.some((b) => b.text === "⬅️")).toBe(true);
  });

  it("page за границей зажимается в допустимый диапазон", () => {
    const wallets = Array.from({ length: 10 }, (_, i) => wallet(`0x${i}`));
    const kb = buildWhalesKeyboard(wallets, 99, 8);
    // последняя страница: 2 кошелька + навигация
    expect(kb[0]?.[0]).toMatchObject({ callback_data: `${CB_CARD}0x8` });
  });
});

describe("buildWalletCardKeyboard", () => {
  it("показывает 'Следить' когда не подписан", () => {
    const kb = buildWalletCardKeyboard("0xabc", false);
    expect(kb[0]?.[0]).toMatchObject({ callback_data: `${CB_FOLLOW}0xabc`, text: expect.stringContaining("Следить") });
    expect(kb[0]?.[1]).toMatchObject({ callback_data: `${CB_PNL}0xabc` });
  });

  it("показывает 'Не следить' когда подписан", () => {
    const kb = buildWalletCardKeyboard("0xabc", true);
    expect(kb[0]?.[0]).toMatchObject({ callback_data: `${CB_UNFOLLOW}0xabc` });
  });

  it("содержит url-кнопку на профиль Polymarket", () => {
    const kb = buildWalletCardKeyboard("0xabc", false);
    const urlBtn = kb[1]?.[0];
    expect(urlBtn).toMatchObject({ url: "https://polymarket.com/profile/0xabc" });
  });
});
