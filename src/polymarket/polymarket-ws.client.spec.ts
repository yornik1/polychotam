import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";
import {
  POLYMARKET_WS_LAST_TRADE_PRICE,
} from "./polymarket-ws-trade.parser.js";
import { TRADES_JOB_PROCESS } from "../queue/trades-queue.config.js";
import type { TradeEvent } from "./dto/trade-event.js";

type WsClientInternals = Pick<PolymarketWsClient, never> & {
  handleMessage(data: Buffer | string): void;
};

describe("PolymarketWsClient", () => {
  it("ставит last_trade_price в очередь trades", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const tradesQueue = { add } as Pick<Queue<TradeEvent>, "add"> as Queue<TradeEvent>;

    const config = {
      getOrThrow: vi.fn().mockReturnValue("wss://example/ws"),
    } as Pick<ConfigService, "getOrThrow"> as ConfigService;

    const http = {} as Pick<PolymarketHttpClient, never> as PolymarketHttpClient;

    const client = new PolymarketWsClient(config, http, tradesQueue);

    const payload = {
      asset_id: "aid1",
      event_type: POLYMARKET_WS_LAST_TRADE_PRICE,
      market: "0xm1",
      price: "0.5",
      side: "BUY",
      size: "10",
      timestamp: "1000",
    };

    (client as unknown as WsClientInternals).handleMessage(
      JSON.stringify(payload),
    );

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data] = add.mock.calls[0]!;
    expect(name).toBe(TRADES_JOB_PROCESS);
    expect(data).toEqual({
      wallet: "",
      amount: "10",
      side: "BUY",
      price: "0.5",
      market: "0xm1",
      assetId: "aid1",
      timestamp: 1000,
    });
  });
});
