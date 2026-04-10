import { describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import type { TradeEvent } from "../polymarket/dto/trade-event.js";
import { Market } from "../markets/market.entity.js";
import { Trade } from "./trade.entity.js";
import { TradesService } from "./trades.service.js";

describe("TradesService.saveFromWsTradeEvent", () => {
  it("не трогает БД при пустом market", async () => {
    const marketFindOne = vi.fn();
    const tradeFindOne = vi.fn();
    const service = new TradesService(
      {
        findOne: tradeFindOne,
        create: vi.fn(),
        save: vi.fn(),
      } as unknown as Repository<Trade>,
      {
        findOne: marketFindOne,
        create: vi.fn(),
        save: vi.fn(),
      } as unknown as Repository<Market>,
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "1",
      side: "BUY",
      price: "0.5",
      market: "   ",
      assetId: "a1",
      timestamp: 1_700_000_000_000,
    };

    await service.saveFromWsTradeEvent(event);

    expect(marketFindOne).not.toHaveBeenCalled();
    expect(tradeFindOne).not.toHaveBeenCalled();
  });

  it("создаёт маркет-заглушку и сделку при первом событии", async () => {
    const conditionId =
      "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347";
    const stubMarket = {
      condition_id: conditionId,
      question: `(ws) ${conditionId}`,
      market_slug: expect.stringMatching(/^ws-[a-f0-9]{64}$/),
      tokens: [],
      active: true,
      closed: false,
      accepting_orders: null,
      liquidity: 0,
      volume24hr: 0,
      end_date_iso: null,
      internal_synced_at: null,
    };

    const savedMarket = {
      ...stubMarket,
      condition_id: conditionId,
    } as Market;

    const marketFindOne = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedMarket);
    const marketCreate = vi.fn((m: Market) => m);
    const marketSave = vi.fn().mockResolvedValue(undefined);

    const tradeFindOne = vi.fn().mockResolvedValue(null);
    const tradeCreate = vi.fn((t: Trade) => t);
    const tradeSave = vi.fn().mockResolvedValue(undefined);

    const service = new TradesService(
      {
        findOne: tradeFindOne,
        create: tradeCreate,
        save: tradeSave,
      } as unknown as Repository<Trade>,
      {
        findOne: marketFindOne,
        create: marketCreate,
        save: marketSave,
      } as unknown as Repository<Market>,
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "219.217767",
      side: "BUY",
      price: "0.456",
      market: conditionId,
      assetId:
        "114122071509644379678018727908709560226618148003371446110114509806601493071694",
      timestamp: 1750428146322,
    };

    await service.saveFromWsTradeEvent(event);

    expect(marketCreate).toHaveBeenCalledWith(
      expect.objectContaining(stubMarket),
    );
    expect(marketSave).toHaveBeenCalledTimes(1);
    expect(tradeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "RECORDED_WS",
        side: "BUY",
        size: "219.217767",
        price: "0.456",
        asset_id: event.assetId,
        owner: "unknown",
        maker_address: "unknown",
        maker_orders: [],
      }),
    );
    expect(tradeSave).toHaveBeenCalledTimes(1);
  });

  it("пропускает insert сделки если id уже есть (идемпотентность retry)", async () => {
    const conditionId = "0xc1";
    const savedMarket = { condition_id: conditionId } as Market;

    const marketFindOne = vi.fn().mockResolvedValue(savedMarket);
    const tradeFindOne = vi.fn().mockResolvedValue({ id: "ws:x" } as Trade);
    const tradeSave = vi.fn();

    const service = new TradesService(
      {
        findOne: tradeFindOne,
        create: vi.fn(),
        save: tradeSave,
      } as unknown as Repository<Trade>,
      {
        findOne: marketFindOne,
        create: vi.fn(),
        save: vi.fn(),
      } as unknown as Repository<Market>,
    );

    const event: TradeEvent = {
      wallet: "",
      amount: "1",
      side: "BUY",
      price: "0.5",
      market: conditionId,
      assetId: "a1",
      timestamp: 1000,
    };

    await service.saveFromWsTradeEvent(event);

    expect(tradeSave).not.toHaveBeenCalled();
  });

  it("для historical payload использует upsert по каноническому trade_id", async () => {
    const conditionId =
      "0x6a67b9d828d53862160e470329ffea5246f338ecfffdf2cab45211ec578b0347";
    const savedMarket = { condition_id: conditionId } as Market;

    const marketFindOne = vi.fn().mockResolvedValue(savedMarket);
    const tradeFindOne = vi.fn();
    const tradeSave = vi.fn();
    const tradeUpsert = vi.fn().mockResolvedValue(undefined);

    const service = new TradesService(
      {
        findOne: tradeFindOne,
        create: vi.fn((t: Trade) => t),
        save: tradeSave,
        upsert: tradeUpsert,
      } as unknown as Repository<Trade>,
      {
        findOne: marketFindOne,
        create: vi.fn(),
        save: vi.fn(),
      } as unknown as Repository<Market>,
    );

    const historicalEvent = {
      wallet: "0xowner",
      amount: "219.217767",
      side: "BUY" as const,
      price: "0.456",
      market: conditionId,
      assetId:
        "114122071509644379678018727908709560226618148003371446110114509806601493071694",
      timestamp: 1750428146322,
      tradeId: "trade-123",
      takerOrderId: "taker-order-123",
      makerAddress: "0xmaker",
      transactionHash:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      outcome: "YES",
      bucketIndex: 0,
      status: "MATCHED",
      traderSide: "TAKER" as const,
    };

    await service.saveFromWsTradeEvent(
      historicalEvent as unknown as TradeEvent,
    );

    expect(tradeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        trade_id: "trade-123",
        taker_order_id: "taker-order-123",
        maker_address: "0xmaker",
        owner: "0xowner",
        transaction_hash:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        status: "MATCHED",
      }),
      ["trade_id"],
    );
    expect(tradeSave).not.toHaveBeenCalled();
    expect(tradeFindOne).not.toHaveBeenCalled();
  });
});
