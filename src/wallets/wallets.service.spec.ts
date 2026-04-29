import { describe, it, expect, vi } from "vitest";
import { Repository } from "typeorm";
import { Market } from "../markets/market.entity.js";
import { Trade } from "../trades/trade.entity.js";
import { Wallet } from "./wallet.entity";
import { WalletsService } from "./wallets.service";

describe("WalletsService", () => {
  function createService() {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const getMany = vi.fn().mockResolvedValue([]);
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getMany,
    };
    const createQueryBuilder = vi.fn().mockReturnValue(queryBuilder);
    const walletRepository = {
      upsert,
      createQueryBuilder,
    } as Pick<Repository<Wallet>, "upsert" | "createQueryBuilder">;

    const find = vi.fn().mockResolvedValue([]);
    const tradeGetRawMany = vi.fn().mockResolvedValue([]);
    const tradeQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawMany: tradeGetRawMany,
    };
    const tradeCreateQueryBuilder = vi.fn().mockReturnValue(tradeQueryBuilder);
    const tradeRepository = {
      find,
      createQueryBuilder: tradeCreateQueryBuilder,
    } as Pick<Repository<Trade>, "find" | "createQueryBuilder">;

    const service = new WalletsService(
      walletRepository as Repository<Wallet>,
      tradeRepository as Repository<Trade>,
    );
    return {
      service,
      upsert,
      find,
      createQueryBuilder,
      queryBuilder,
      getMany,
      tradeCreateQueryBuilder,
      tradeQueryBuilder,
      tradeGetRawMany,
    };
  }

  it("вызывает repository.upsert с conflictPaths address", async () => {
    const { service, upsert } = createService();
    const payload = {
      address: "0xabc",
      total_won: "10",
      total_lost: "2",
      win_rate: "0.5",
      trade_count: 7,
    };

    await service.upsert(payload);

    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, conflictPaths] = upsert.mock.calls[0]!;
    expect(conflictPaths).toEqual(["address"]);
    expect(row).toMatchObject({
      address: payload.address,
      total_won: payload.total_won,
      total_lost: payload.total_lost,
      win_rate: payload.win_rate,
      trade_count: payload.trade_count,
    });
    expect(row).toHaveProperty("internal_updated_at");
    expect(row.internal_updated_at).toBeInstanceOf(Date);
  });

  it("recalculate считает realised P&L и trade_count только по resolved trades", async () => {
    const { service, find, upsert } = createService();

    find.mockResolvedValue([
      {
        asset_id: "token-yes",
        side: "BUY",
        size: "10",
        price: "0.4",
        maker_address: "0xabc",
        market: {
          closed: true,
          winning_token_id: "token-yes",
        } as Market,
      },
      {
        asset_id: "token-no",
        side: "BUY",
        size: "5",
        price: "0.25",
        maker_address: "0xabc",
        market: {
          closed: true,
          winning_token_id: "token-yes",
        } as Market,
      },
      {
        asset_id: "token-no",
        side: "SELL",
        size: "2",
        price: "0.7",
        maker_address: "0xabc",
        market: {
          closed: true,
          winning_token_id: "token-yes",
        } as Market,
      },
      {
        asset_id: "token-open",
        side: "BUY",
        size: "9",
        price: "0.3",
        maker_address: "0xabc",
        market: {
          closed: false,
          winning_token_id: null,
        } as Market,
      },
    ] as Trade[]);

    await service.recalculate("0xabc");

    expect(find).toHaveBeenCalledWith({
      where: { maker_address: "0xabc" },
      relations: { market: true },
      order: { match_time: "ASC" },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0xabc",
        total_won: "7.4",
        total_lost: "1.25",
        win_rate: "0.666667",
        trade_count: 3,
      }),
      ["address"],
    );
  });

  it("getTopWallets читает только кеш wallets по trade_count и win_rate", async () => {
    const { service, createQueryBuilder, queryBuilder, getMany } = createService();
    const rows = [
      {
        address: "0x1",
        total_won: "5",
        total_lost: "1",
        win_rate: "0.8",
        trade_count: 6,
      },
    ];
    getMany.mockResolvedValue(rows);

    const result = await service.getTopWallets();

    expect(createQueryBuilder).toHaveBeenCalledWith("wallet");
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "wallet.trade_count >= :minTradeCount",
      { minTradeCount: 5 },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(wallet.win_rate > :zero OR wallet.total_won > :zero OR wallet.total_lost > :zero)",
      { zero: "0" },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith("wallet.win_rate", "DESC");
    expect(queryBuilder.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual(rows);
  });

  it("isTopWallet кеширует top-10 на TTL и не дёргает БД повторно", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    const { service, getMany } = createService();
    getMany.mockResolvedValue([
      {
        address: "0xtop",
        total_won: "10",
        total_lost: "1",
        win_rate: "0.9",
        trade_count: 12,
      },
    ]);

    await expect(service.isTopWallet("0xtop")).resolves.toBe(true);

    nowSpy.mockReturnValue(1_500);
    await expect(service.isTopWallet("0xtop")).resolves.toBe(true);

    expect(getMany).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("getTopWalletsByVolumeOnTopMarkets суммирует объём в USDC (size × price) и фильтрует по нему", async () => {
    const { service, tradeCreateQueryBuilder, tradeQueryBuilder, tradeGetRawMany } = createService();
    tradeGetRawMany.mockResolvedValue([
      { address: "  0xabc  ", total_volume: "44000.5", trade_count: "3" },
    ]);

    const result = await service.getTopWalletsByVolumeOnTopMarkets(10);

    expect(tradeCreateQueryBuilder).toHaveBeenCalledWith("trade");
    expect(tradeQueryBuilder.select).toHaveBeenCalledWith("trade.maker_address", "address");
    expect(tradeQueryBuilder.addSelect).toHaveBeenCalledWith(
      "SUM(CAST(trade.size AS DECIMAL) * CAST(trade.price AS DECIMAL))",
      "total_volume",
    );
    expect(tradeQueryBuilder.addSelect).toHaveBeenCalledWith("COUNT(*)", "trade_count");
    expect(tradeQueryBuilder.innerJoin).toHaveBeenCalledWith("trade.market", "market");
    expect(tradeQueryBuilder.where).toHaveBeenCalledWith("market.volume24hr > :minVolume", {
      minVolume: 1000000,
    });
    expect(tradeQueryBuilder.andWhere).toHaveBeenCalledWith(
      "CAST(trade.size AS DECIMAL) * CAST(trade.price AS DECIMAL) > :minTradeSize",
      { minTradeSize: 10000 },
    );
    expect(tradeQueryBuilder.groupBy).toHaveBeenCalledWith("trade.maker_address");
    expect(tradeQueryBuilder.orderBy).toHaveBeenCalledWith("total_volume", "DESC");
    expect(tradeQueryBuilder.limit).toHaveBeenCalledWith(10);

    expect(result).toEqual([{ address: "0xabc", totalVolume: "44000.5", tradeCount: 3 }]);
  });

  it("isTopWallet возвращает false для адреса вне кешированного top-10", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(2_000);
    const { service, getMany } = createService();
    getMany.mockResolvedValue([
      {
        address: "0xtop",
        total_won: "10",
        total_lost: "1",
        win_rate: "0.9",
        trade_count: 12,
      },
    ]);

    await expect(service.isTopWallet("0xother")).resolves.toBe(false);

    expect(getMany).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});
