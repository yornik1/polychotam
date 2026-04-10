import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { TelegramService } from "./telegram.service.js";

describe("TelegramService", () => {
  it("getBotToken читает TELEGRAM_BOT_TOKEN через ConfigService.getOrThrow", () => {
    const getOrThrow = vi.fn().mockReturnValue("bot-token");
    const service = new TelegramService(
      { getOrThrow } as unknown as ConfigService,
      { telegram: { sendMessage: vi.fn() } } as never,
    );

    const token = service.getBotToken();

    expect(getOrThrow).toHaveBeenCalledWith("TELEGRAM_BOT_TOKEN");
    expect(token).toBe("bot-token");
  });

  it("sendAlert отправляет сообщение в TELEGRAM_CHAT_ID", async () => {
    const getOrThrow = vi.fn().mockReturnValue("bot-token");
    const get = vi.fn((key: string) => {
      if (key === "TELEGRAM_CHAT_ID") {
        return "123456";
      }

      return undefined;
    });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const service = new TelegramService(
      { getOrThrow, get } as unknown as ConfigService,
      { telegram: { sendMessage } } as never,
    );

    await expect(service.sendAlert("alert-message")).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledWith("123456", "alert-message");
  });

  it("sendAlert не бросает и возвращает false без TELEGRAM_CHAT_ID", async () => {
    const getOrThrow = vi.fn().mockReturnValue("bot-token");
    const get = vi.fn().mockReturnValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const service = new TelegramService(
      { getOrThrow, get } as unknown as ConfigService,
      { telegram: { sendMessage } } as never,
    );

    await expect(service.sendAlert("alert-message")).resolves.toBe(false);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
