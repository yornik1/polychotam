import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletScoreService } from "./wallet-score.service.js";
import type { Repository } from "typeorm";
import type { WalletScore } from "./wallet-score.entity.js";
import type { Trade } from "../trades/trade.entity.js";
import type { WalletPnlV2Service } from "./wallet-pnl-v2.service.js";
import type { SmartWalletsService } from "./smart-wallets.service.js";
import type { ConfigService } from "@nestjs/config";

/** Вспомогательные типы для моков */
type MockRepo = {
  createQueryBuilder: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function makeTradeQb(trades: Partial<Trade>[]): unknown {
  const qb = {
    innerJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(trades),
  };
  return qb;
}

function makeScoreQb(results: Partial<WalletScore>[] = []): unknown {
  const qb = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(results),
  };
  return qb;
}

/** Строит resolved сделку с указанным asset_id и параметрами */
function makeTrade(
  asset_id: string,
  winningTokenId: string,
  side: "BUY" | "SELL",
  size: string,
  price: string,
  category: string | null = null,
): Partial<Trade> {
  return {
    asset_id,
    side,
    size,
    price,
    market: {
      closed: true,
      winning_token_id: winningTokenId,
      category,
    } as unknown as Trade["market"],
  };
}

describe("WalletScoreService", () => {
  let tradeRepo: MockRepo;
  let scoreRepo: MockRepo;
  let walletPnlV2Service: Partial<WalletPnlV2Service>;
  let smartWalletsService: Partial<SmartWalletsService>;
  let configService: Partial<ConfigService>;
  let service: WalletScoreService;

  beforeEach(() => {
    tradeRepo = {
      createQueryBuilder: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    };
    scoreRepo = {
      createQueryBuilder: vi.fn(),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    walletPnlV2Service = {
      getOrComputePnl: vi.fn().mockResolvedValue({ totalPnl: 1000 }),
    };
    smartWalletsService = {
      getActiveWhitelist: vi.fn().mockResolvedValue([]),
    };
    configService = {
      get: vi.fn().mockReturnValue(0.55),
    };

    service = new WalletScoreService(
      tradeRepo as unknown as Repository<Trade>,
      scoreRepo as unknown as Repository<WalletScore>,
      walletPnlV2Service as WalletPnlV2Service,
      smartWalletsService as SmartWalletsService,
      configService as ConfigService,
    );
  });

  describe("recalcScores", () => {
    it("пропускает кошелёк с sampleSize=29 (gate) — не пишет в scoreRepo", async () => {
      // 29 выигрышных resolved сделок
      const trades = Array.from({ length: 29 }, () =>
        makeTrade("token-win", "token-win", "BUY", "100", "0.5"),
      );
      tradeRepo.createQueryBuilder.mockReturnValue(makeTradeQb(trades));
      (smartWalletsService.getActiveWhitelist as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "0xabc" },
      ]);

      await service.recalcScores();

      expect(scoreRepo.upsert).not.toHaveBeenCalled();
      // delete вызывается для очистки существующей записи
      expect(scoreRepo.delete).toHaveBeenCalledWith({ address: "0xabc" });
    });

    it("пишет upsert при sampleSize=30 (граница gate)", async () => {
      const trades = Array.from({ length: 30 }, () =>
        makeTrade("token-win", "token-win", "BUY", "100", "0.5"),
      );
      tradeRepo.createQueryBuilder.mockReturnValue(makeTradeQb(trades));
      (smartWalletsService.getActiveWhitelist as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "0xabc" },
      ]);

      await service.recalcScores();

      expect(scoreRepo.upsert).toHaveBeenCalledOnce();
    });

    it("profit factor = null при нулевых убытках — score считается (не null)", async () => {
      // все сделки выигрышные → убытков нет → profitFactor=null
      const trades = Array.from({ length: 30 }, () =>
        makeTrade("token-win", "token-win", "BUY", "100", "0.5"),
      );
      tradeRepo.createQueryBuilder.mockReturnValue(makeTradeQb(trades));
      (smartWalletsService.getActiveWhitelist as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "0xabc" },
      ]);

      await service.recalcScores();

      expect(scoreRepo.upsert).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const upsertArg = (scoreRepo.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(upsertArg.profit_factor).toBeNull();
      expect(Number(upsertArg.score)).toBeGreaterThan(0);
    });

    it("специализация корректно группирует по category (null → other)", async () => {
      const trades = [
        ...Array.from({ length: 15 }, () =>
          makeTrade("token-win", "token-win", "BUY", "100", "0.5", "politics"),
        ),
        ...Array.from({ length: 10 }, () =>
          makeTrade("token-win", "token-win", "BUY", "100", "0.5", null),
        ),
        ...Array.from({ length: 5 }, () =>
          makeTrade("token-win", "token-win", "BUY", "100", "0.5", "crypto"),
        ),
      ];
      tradeRepo.createQueryBuilder.mockReturnValue(makeTradeQb(trades));
      (smartWalletsService.getActiveWhitelist as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "0xabc" },
      ]);

      await service.recalcScores();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const upsertArg = (scoreRepo.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const spec = upsertArg.specialization;
      expect(spec.politics.resolvedCount).toBe(15);
      expect(spec.other.resolvedCount).toBe(10); // null → other
      expect(spec.crypto.resolvedCount).toBe(5);
      expect(spec.sports.resolvedCount).toBe(0);
    });

    it("не пишет при ошибке getOrComputePnl", async () => {
      const trades = Array.from({ length: 30 }, () =>
        makeTrade("token-win", "token-win", "BUY", "100", "0.5"),
      );
      tradeRepo.createQueryBuilder.mockReturnValue(makeTradeQb(trades));
      (walletPnlV2Service.getOrComputePnl as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("network"),
      );
      (smartWalletsService.getActiveWhitelist as ReturnType<typeof vi.fn>).mockResolvedValue([
        { address: "0xabc" },
      ]);

      await service.recalcScores();

      expect(scoreRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe("getTopByScore", () => {
    it("возвращает результаты из query builder", async () => {
      const mockResults = [{ address: "0xabc", score: "75.5" }];
      scoreRepo.createQueryBuilder.mockReturnValue(makeScoreQb(mockResults));

      const result = await service.getTopByScore(10);

      expect(result).toEqual(mockResults);
    });

    it("фильтрует validated=false — JOIN обеспечивает только validated=true", async () => {
      const qb = makeScoreQb([]) as {
        innerJoin: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
        orderBy: ReturnType<typeof vi.fn>;
        limit: ReturnType<typeof vi.fn>;
        getMany: ReturnType<typeof vi.fn>;
      };
      scoreRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getTopByScore(5);

      // innerJoin должен содержать условие validated = true
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const joinCall = (qb.innerJoin as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(joinCall[1]).toContain("snap");
      expect(joinCall[2]).toContain("validated = true");
    });

    it("фильтрует win_rate строго: ровно 0.55 НЕ проходит (acceptance: >55%)", async () => {
      const qb = makeScoreQb([]) as {
        innerJoin: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
        orderBy: ReturnType<typeof vi.fn>;
        limit: ReturnType<typeof vi.fn>;
        getMany: ReturnType<typeof vi.fn>;
      };
      scoreRepo.createQueryBuilder.mockReturnValue(qb);
      // configService возвращает 0.55
      (configService.get as ReturnType<typeof vi.fn>).mockReturnValue(0.55);

      await service.getTopByScore(10);

      // where должен содержать строгое > :minWinRate (граница 0.55 отсекается)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const whereCall = (qb.where as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(whereCall[0]).toContain("> :minWinRate");
      expect(whereCall[0]).not.toContain(">=");
      expect(whereCall[1]).toEqual({ minWinRate: 0.55 });
    });

    it("использует limit из параметра", async () => {
      const qb = makeScoreQb([]) as {
        innerJoin: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
        orderBy: ReturnType<typeof vi.fn>;
        limit: ReturnType<typeof vi.fn>;
        getMany: ReturnType<typeof vi.fn>;
      };
      scoreRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getTopByScore(7);

      expect((qb.limit as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(7);
    });
  });
});
