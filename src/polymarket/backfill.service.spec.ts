import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import type { TradeEvent } from "./dto/trade-event.js";
import { TRADES_JOB_PROCESS } from "../queue/trades-queue.config.js";
import { createHash } from "node:crypto";

describe("BackfillService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("загружает historical trades и ставит их в очередь в едином контракте", async () => {
    const imported = await import("./backfill.service.js").catch(() => null);

    expect(imported).not.toBeNull();
    if (imported === null) {
      return;
    }

    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as Pick<Queue<TradeEvent>, "add"> as Queue<TradeEvent>;
    const config = {
      get: vi.fn((key: string) =>
        key === "POLYMARKET_DATA_API_URL"
          ? "https://data-api.polymarket.com"
          : undefined,
      ),
    } as Pick<ConfigService, "get"> as ConfigService;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          proxyWallet: "0x1234567890123456789012345678901234567890",
          side: "BUY",
          asset:
            "114122071509644379678018727908709560226618148003371446110114509806601493071694",
          conditionId:
            "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347",
          size: 219.217767,
          price: 0.456,
          timestamp: 1700000000,
          outcome: "YES",
          outcomeIndex: 0,
          transactionHash:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      ]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new imported.BackfillService(config, queue);

    await service.backfill(
      "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347",
      500,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://data-api.polymarket.com/trades?market=0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347&limit=500",
    );
    expect(add).toHaveBeenCalledWith(
      TRADES_JOB_PROCESS,
      expect.objectContaining({
        wallet: "",
        amount: "219.217767",
        side: "BUY",
        price: "0.456",
        market:
          "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347",
        assetId:
          "114122071509644379678018727908709560226618148003371446110114509806601493071694",
        timestamp: 1700000000,
        tradeId: `public:${createHash("sha256").update("0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347|114122071509644379678018727908709560226618148003371446110114509806601493071694|BUY|219.217767|0.456|1700000000|0x1234567890123456789012345678901234567890|0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef|YES|0").digest("hex")}`,
        makerAddress: "0x1234567890123456789012345678901234567890",
        transactionHash:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        outcome: "YES",
        bucketIndex: 0,
        owner: "0x1234567890123456789012345678901234567890",
      }),
    );
  });
});
