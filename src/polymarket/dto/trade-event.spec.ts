import { describe, expect, it } from "vitest";
import type { TradeEvent } from "../../types/contracts.js";

describe("TradeEvent", () => {
  it("допускает валидный объект сделки", () => {
    const event: TradeEvent = {
      wallet: "",
      amount: "219.217767",
      side: "BUY",
      price: "0.456",
      market: "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347",
      assetId: "114122071509644379678018727908709560226618148003371446110114509806601493071694",
      timestamp: 1750428146322,
    };
    expect(event.side).toBe("BUY");
    expect(event.amount).toBe("219.217767");
  });
});
