import { describe, expect, it } from "vitest";
import { isAdminChat } from "./admin-guard.util.js";

describe("isAdminChat", () => {
  it("возвращает true, если chatId совпадает со строкой adminChatId", () => {
    expect(isAdminChat("123456", "123456")).toBe(true);
  });

  it("возвращает true, если chatId — число, совпадающее с adminChatId", () => {
    expect(isAdminChat(123456, "123456")).toBe(true);
  });

  it("возвращает false при несовпадении", () => {
    expect(isAdminChat("999", "123456")).toBe(false);
  });

  it("возвращает false, если chatId — undefined", () => {
    expect(isAdminChat(undefined, "123456")).toBe(false);
  });

  it("возвращает false, если adminChatId пустая строка", () => {
    expect(isAdminChat("123456", "")).toBe(false);
  });

  it("возвращает false, если adminChatId — только пробелы", () => {
    expect(isAdminChat("123456", "   ")).toBe(false);
  });

  it("нормализует пробелы вокруг chatId", () => {
    expect(isAdminChat(" 123456 ", "123456")).toBe(true);
  });

  it("нормализует пробелы вокруг adminChatId", () => {
    expect(isAdminChat("123456", " 123456 ")).toBe(true);
  });
});
