import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import type { PolymarketMarketResolutionService } from "./polymarket-market-resolution.service.js";
import type { PolymarketWsStatusService } from "./polymarket-ws-status.service.js";
import type { WsUptimeService } from "./ws-uptime.service.js";
import { PolymarketWsClient } from "./polymarket-ws.client.js";
import {
  POLYMARKET_WS_LAST_TRADE_PRICE,
} from "./polymarket-ws-trade.parser.js";
import { TRADES_JOB_PROCESS } from "../queue/trades-queue.config.js";
import type { TradeEvent } from "./dto/trade-event.js";

const wsHarness = vi.hoisted(() => {
  class MockSocket {
    private readonly h: Partial<Record<string, (...args: unknown[]) => void>> = {};
    on(ev: string, fn: (...args: unknown[]) => void): void {
      this.h[ev] = fn;
    }
    send = vi.fn();
    removeAllListeners = vi.fn();
    close = vi.fn(() => {
      this.h.close?.(1000, Buffer.from(""));
    });
    fireOpen(): void {
      this.h.open?.();
    }
    fireClose(): void {
      this.h.close?.(1000, Buffer.from(""));
    }
    fireError(err: Error): void {
      this.h.error?.(err);
    }
  }

  let latest: MockSocket | null = null;

  function createInstance(): MockSocket {
    latest = new MockSocket();
    return latest;
  }

  /** Вызов через `new WebSocket(url)` в клиенте. */
  function WebSocketMock(_url: string): MockSocket {
    return createInstance();
  }

  return { WebSocketMock, getLatest: () => latest };
});

vi.mock("ws", () => ({
  default: wsHarness.WebSocketMock,
}));

type WsClientInternals = Pick<PolymarketWsClient, never> & {
  handleMessage(data: Buffer | string): void;
  dispatchParsedWsPayload(parsed: unknown): void;
};

function createWsStatusMock(): Pick<
  PolymarketWsStatusService,
  "setConnected" | "recordReconnect"
> {
  return {
    setConnected: vi.fn(),
    recordReconnect: vi.fn(),
  };
}

describe("PolymarketWsClient", () => {
  it("ставит last_trade_price в очередь trades", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const tradesQueue = { add } as Pick<Queue<TradeEvent>, "add"> as Queue<TradeEvent>;

    const config = {
      getOrThrow: vi.fn().mockReturnValue("wss://example/ws"),
    } as Pick<ConfigService, "getOrThrow"> as ConfigService;

    const http = {} as Pick<PolymarketHttpClient, never> as PolymarketHttpClient;

    const resolution = {
      applyMarketResolvedFromWs: vi.fn().mockResolvedValue(undefined),
    } as Pick<
      PolymarketMarketResolutionService,
      "applyMarketResolvedFromWs"
    > as PolymarketMarketResolutionService;

    const wsUptime = {
      markOpen: vi.fn().mockResolvedValue(undefined),
      markClose: vi.fn().mockResolvedValue(undefined),
    } as Pick<WsUptimeService, "markOpen" | "markClose"> as WsUptimeService;

    const wsStatus = createWsStatusMock() as PolymarketWsStatusService;
    const client = new PolymarketWsClient(
      config,
      http,
      resolution,
      wsStatus,
      wsUptime,
      tradesQueue,
    );

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

  it("вызывает applyMarketResolvedFromWs для market_resolved", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const tradesQueue = { add } as Pick<Queue<TradeEvent>, "add"> as Queue<TradeEvent>;
    const config = {
      getOrThrow: vi.fn().mockReturnValue("wss://example/ws"),
    } as Pick<ConfigService, "getOrThrow"> as ConfigService;
    const http = {} as Pick<PolymarketHttpClient, never> as PolymarketHttpClient;
    const applyMarketResolvedFromWs = vi.fn().mockResolvedValue(undefined);
    const resolution = {
      applyMarketResolvedFromWs,
    } as Pick<
      PolymarketMarketResolutionService,
      "applyMarketResolvedFromWs"
    > as PolymarketMarketResolutionService;

    const wsUptime = {
      markOpen: vi.fn().mockResolvedValue(undefined),
      markClose: vi.fn().mockResolvedValue(undefined),
    } as Pick<WsUptimeService, "markOpen" | "markClose"> as WsUptimeService;

    const wsStatus = createWsStatusMock() as PolymarketWsStatusService;
    const client = new PolymarketWsClient(
      config,
      http,
      resolution,
      wsStatus,
      wsUptime,
      tradesQueue,
    );

    const payload = {
      event_type: "market_resolved",
      market: "0xabc",
      winning_asset_id: "token-win",
      winning_outcome: "Yes",
    };

    (client as unknown as WsClientInternals).dispatchParsedWsPayload(payload);

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(applyMarketResolvedFromWs).toHaveBeenCalledWith({
      conditionId: "0xabc",
      winningAssetId: "token-win",
      winningOutcome: "Yes",
    });
    expect(add).not.toHaveBeenCalled();
  });

  it("на open и close сокета вызывает WsUptimeService", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const tradesQueue = { add } as Pick<Queue<TradeEvent>, "add"> as Queue<TradeEvent>;
    const config = {
      getOrThrow: vi.fn().mockReturnValue("wss://example/ws"),
    } as Pick<ConfigService, "getOrThrow"> as ConfigService;
    const http = {} as Pick<PolymarketHttpClient, never> as PolymarketHttpClient;
    const resolution = {
      applyMarketResolvedFromWs: vi.fn().mockResolvedValue(undefined),
    } as Pick<
      PolymarketMarketResolutionService,
      "applyMarketResolvedFromWs"
    > as PolymarketMarketResolutionService;

    const markOpen = vi.fn().mockResolvedValue(undefined);
    const markClose = vi.fn().mockResolvedValue(undefined);
    const wsUptime = { markOpen, markClose } as Pick<
      WsUptimeService,
      "markOpen" | "markClose"
    > as WsUptimeService;

    const wsStatus = createWsStatusMock() as PolymarketWsStatusService;
    const client = new PolymarketWsClient(
      config,
      http,
      resolution,
      wsStatus,
      wsUptime,
      tradesQueue,
    );
    await client.connect(["token-a"]);
    const sock = wsHarness.getLatest();
    expect(sock).not.toBeNull();
    sock!.fireOpen();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(markOpen).toHaveBeenCalledTimes(1);
    sock!.fireClose();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(markClose).toHaveBeenCalledTimes(1);
  });
});
