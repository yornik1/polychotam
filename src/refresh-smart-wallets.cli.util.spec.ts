import { describe, expect, it } from "vitest";
import { parseBoolean, parsePositiveInt, parsePositiveNumber } from "./refresh-smart-wallets.cli.util.js";

describe("refresh-smart-wallets cli util", () => {
  it("parses boolean env values and keeps fallback only when unset", () => {
    expect(parseBoolean(undefined, false, "SMART_WALLETS_REFRESH_DRY_RUN")).toBe(false);
    expect(parseBoolean("true", false, "SMART_WALLETS_REFRESH_DRY_RUN")).toBe(true);
    expect(parseBoolean("0", true, "SMART_WALLETS_REFRESH_DRY_RUN")).toBe(false);
  });

  it("throws on malformed boolean env values", () => {
    expect(() => parseBoolean("maybe", false, "SMART_WALLETS_REFRESH_DRY_RUN")).toThrow(
      "SMART_WALLETS_REFRESH_DRY_RUN must be a boolean-like value",
    );
  });

  it("parses positive numeric env values and throws on malformed values", () => {
    expect(parsePositiveInt(undefined, 7, "SMART_WALLETS_REFRESH_LIMIT")).toBe(7);
    expect(parsePositiveInt("4.9", undefined, "SMART_WALLETS_REFRESH_LIMIT")).toBe(4);
    expect(parsePositiveNumber("0.75", undefined, "SMART_WALLETS_REFRESH_MIN_WIN_RATE")).toBe(0.75);

    expect(() => parsePositiveInt("0", undefined, "SMART_WALLETS_REFRESH_LIMIT")).toThrow(
      "SMART_WALLETS_REFRESH_LIMIT must be a positive integer",
    );
    expect(() => parsePositiveNumber("-1", undefined, "SMART_WALLETS_REFRESH_MIN_WIN_RATE")).toThrow(
      "SMART_WALLETS_REFRESH_MIN_WIN_RATE must be a positive number",
    );
  });
});
