import { describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { Market } from "../markets/market.entity.js";
import { Trade } from "../trades/trade.entity.js";
import { MarketsService } from "../markets/markets.service.js";
import { MarketScoreService } from "../markets/market-score.service.js";
import { SmartWalletsService } from "../wallets/smart-wallets.service.js";
import { WalletsService } from "../wallets/wallets.service.js";
import type { MarketScore, WalletPnlSummary, WalletScoreSpecialization } from "../types/contracts.js";
import type { QueueStatsService } from "../queue/queue-stats.service.js";
import type { PolymarketWsStatusService } from "../polymarket/polymarket-ws-status.service.js";
import type { AlertSettingsService } from "../settings/alert-settings.service.js";
import type { WsUptimeService } from "../polymarket/ws-uptime.service.js";
import type { WalletScoreService } from "../wallets/wallet-score.service.js";
import type { TelegramService } from "./telegram.service.js";
import type { WalletScore } from "../wallets/wallet-score.entity.js";
import { TelegramUpdate } from "./telegram.update.js";

interface ReplyContext {
  payload?: string;
  chat?: { id: number };
  reply: (message: string, extra?: unknown) => unknown;
}

const ADMIN_CHAT_ID = "777000";

describe("TelegramUpdate", () => {
  function makeWalletScore(address = "0xABCDEF1234567890"): WalletScore {
    const spec: WalletScoreSpecialization = {
      politics: { winRate: 0.7, resolvedCount: 20 },
      sports: { winRate: null, resolvedCount: 0 },
      crypto: { winRate: null, resolvedCount: 0 },
      other: { winRate: null, resolvedCount: 0 },
    };
    return {
      address,
      pnl_90d: "2000.00",
      win_rate: "0.65",
      profit_factor: "3.0",
      specialization: spec,
      sample_size: 50,
      score: "80.0",
      computed_at: new Date("2026-06-10T12:00:00.000Z"),
      internal_created_at: new Date("2026-06-10T12:00:00.000Z"),
      internal_updated_at: new Date("2026-06-10T12:00:00.000Z"),
    };
  }

  function createUpdate() {
    const findBySlug = vi.fn<(slug: string) => Promise<Market | null>>();
    const findByConditionId = vi.fn<(conditionId: string) => Promise<Market | null>>();
    const getScoreCandidates = vi.fn<(limit?: number) => Promise<Market[]>>();
    const scoreMarket = vi.fn<(market: Market) => MarketScore>();
    const getTopWalletsByVolumeOnTopMarkets = vi.fn<
      () => Promise<Array<{ address: string; totalVolume: string; tradeCount: number }>>
    >();
    const getActiveWhitelist = vi.fn<() => Promise<Array<{
      address: string;
      active: boolean;
      hit_rate: string | null;
      sum_pnl: string | null;
      roi_pct: string | null;
      whale_trade_count: number;
      notes: string;
      source: string;
    }>>>();
    const getWalletDetail = vi.fn<(address: string) => Promise<unknown>>();
    const getHistoricalPnl = vi.fn<(address: string) => Promise<WalletPnlSummary>>();
    const isAlertsEnabled = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const setAlertsEnabled = vi.fn<(v: boolean) => Promise<void>>().mockResolvedValue(undefined);
    const alertSettingsService = { isAlertsEnabled, setAlertsEnabled };
    const getElapsedMs = vi.fn<() => number>().mockReturnValue(0);
    const getUptimeRatio24h = vi.fn<() => Promise<number>>().mockResolvedValue(0.5);
    const wsUptimeService = { getElapsedMs, getUptimeRatio24h };
    const queueStatsService = {
      getAllQueueCounts: vi.fn().mockResolvedValue([]),
      getRecentErrors: vi.fn().mockResolvedValue({ entries: [], totalInTail: 0 }),
    };
    const wsStatusService = {
      isConnected: vi.fn().mockReturnValue(true),
      getSubscribedAssets: vi.fn().mockReturnValue(0),
      getReconnectsLast24h: vi.fn().mockReturnValue(0),
    };
    const configService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === "ADMIN_CHAT_ID") return ADMIN_CHAT_ID;
        throw new Error(`Unexpected key: ${key}`);
      }),
    };
    const getTopByScore = vi.fn<(limit: number) => Promise<WalletScore[]>>();
    const sendAdminAlert = vi.fn<(msg: string) => Promise<boolean>>().mockResolvedValue(true);

    const update = new TelegramUpdate(
      { findBySlug, findByConditionId, getScoreCandidates } as unknown as MarketsService,
      { scoreMarket } as unknown as MarketScoreService,
      { getTopWalletsByVolumeOnTopMarkets, getHistoricalPnl } as unknown as WalletsService,
      { getActiveWhitelist, getWalletDetail } as unknown as SmartWalletsService,
      queueStatsService as unknown as QueueStatsService,
      wsStatusService as unknown as PolymarketWsStatusService,
      {} as unknown as Repository<Trade>,
      {} as unknown as Repository<Market>,
      alertSettingsService as unknown as AlertSettingsService,
      wsUptimeService as unknown as WsUptimeService,
      configService as unknown as ConfigService,
      { getTopByScore } as unknown as WalletScoreService,
      { sendAdminAlert } as unknown as TelegramService,
    );

    return {
      update,
      findBySlug,
      findByConditionId,
      getScoreCandidates,
      scoreMarket,
      getTopWalletsByVolumeOnTopMarkets,
      getActiveWhitelist,
      getWalletDetail,
      getHistoricalPnl,
      alertSettingsService,
      wsUptimeService,
      queueStatsService,
      wsStatusService,
      getTopByScore,
      sendAdminAlert,
    };
  }

  function walletPnlSummary(): WalletPnlSummary {
    return {
      address: "0xabc",
      method: "resolved_only_local_trades",
      period: { from: "2026-01-01T00:00:00.000Z", days: 30 },
      totalPnl: 6,
      totalRisk: 4,
      roi: 1.5,
      winRate: 1,
      includedTradeCount: 1,
      skippedTradeCount: 0,
      dataGaps: [],
      limitations: ["This is not full on-chain wallet P&L."],
    };
  }

  it("отвечает на /start списком команд", async () => {
    const { update } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();

    await update.handleStart({ reply } as ReplyContext);

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("/top"),
      { parse_mode: "HTML" },
    );
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("/market"),
      { parse_mode: "HTML" },
    );
  });

  it("отвечает market summary для найденного slug", async () => {
    const { update, findBySlug } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    findBySlug.mockResolvedValue({
      question: "Trump wins 2024",
      volume24hr: 1250000,
      end_date_iso: "2024-11-05T00:00:00.000Z",
      tokens: [
        { outcome: "YES", price: 0.72 },
        { outcome: "NO", price: 0.28 },
      ],
    } as Market);

    await update.handleMarket({
      payload: "trump-win",
      reply,
    } as ReplyContext);

    expect(findBySlug).toHaveBeenCalledWith("trump-win");
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Trump wins 2024"));
  });

  it("сообщает об ошибке, если slug не найден", async () => {
    const { update, findBySlug } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    findBySlug.mockResolvedValue(null);

    await update.handleMarket({
      payload: "missing-market",
      reply,
    } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Маркет не найден. Попробуй другой slug.");
  });

  it("просит slug, если /market вызвали без аргумента", async () => {
    const { update } = createUpdate();
    const reply = vi.fn<(message: string) => void>();

    await update.handleMarket({
      payload: "   ",
      reply,
    } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Укажи slug: /market <slug>");
  });

  it("отвечает score для найденного slug", async () => {
    const { update, findBySlug, findByConditionId, scoreMarket } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    const market = {
      question: "Will BTC hit $100k?",
      market_slug: "btc-100k",
      condition_id: "condition-1",
    } as Market;
    findBySlug.mockResolvedValue(market);
    scoreMarket.mockReturnValue({
      score: 82,
      conclusion: "strong_watch",
      reasons: [{ code: "high_volume24hr", value: 250_000, impact: "positive" }],
      dataGaps: [],
      hasEnoughData: true,
    });

    await update.handleScore({ payload: "btc-100k", reply } as ReplyContext);

    expect(findBySlug).toHaveBeenCalledWith("btc-100k");
    expect(findByConditionId).not.toHaveBeenCalled();
    expect(scoreMarket).toHaveBeenCalledWith(market);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Score: 82/100"));
  });

  it("просит адрес, если /pnl вызвали без аргумента", async () => {
    const { update, getHistoricalPnl } = createUpdate();
    const reply = vi.fn<(message: string) => void>();

    await update.handlePnl({ payload: "   ", reply } as ReplyContext);

    expect(getHistoricalPnl).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("Укажи адрес: /pnl <0xADDR> [days]");
  });

  it("отвечает wallet P&L estimate для /pnl address days", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { update, getHistoricalPnl } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getHistoricalPnl.mockResolvedValue(walletPnlSummary());

    await update.handlePnl({ payload: "  0xabc  7  ", reply } as ReplyContext);

    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 7,
      from: new Date("2026-01-25T00:00:00.000Z"),
    });
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Wallet P&amp;L estimate"),
      { parse_mode: "HTML", disable_web_page_preview: true },
    );
    nowSpy.mockRestore();
  });

  it("для invalid /pnl days использует default 30", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { update, getHistoricalPnl } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getHistoricalPnl.mockResolvedValue(walletPnlSummary());

    await update.handlePnl({ payload: "0xabc nope", reply } as ReplyContext);

    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 30,
      from: new Date("2026-01-02T00:00:00.000Z"),
    });
    nowSpy.mockRestore();
  });

  it("для huge /pnl days использует default 30", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { update, getHistoricalPnl } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getHistoricalPnl.mockResolvedValue(walletPnlSummary());

    await update.handlePnl({ payload: "0xabc 999999999999999999999", reply } as ReplyContext);

    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 30,
      from: new Date("2026-01-02T00:00:00.000Z"),
    });
    nowSpy.mockRestore();
  });

  it("ищет score по condition id, если slug не найден", async () => {
    const { update, findBySlug, findByConditionId, scoreMarket } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    const market = {
      question: "Will ETH hit $10k?",
      market_slug: "eth-10k",
      condition_id: "condition-2",
    } as Market;
    findBySlug.mockResolvedValue(null);
    findByConditionId.mockResolvedValue(market);
    scoreMarket.mockReturnValue({
      score: 65,
      conclusion: "medium_watch",
      reasons: [],
      dataGaps: [],
      hasEnoughData: true,
    });

    await update.handleScore({ payload: "condition-2", reply } as ReplyContext);

    expect(findBySlug).toHaveBeenCalledWith("condition-2");
    expect(findByConditionId).toHaveBeenCalledWith("condition-2");
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("ETH"));
  });

  it("сообщает, если рынок для score не найден", async () => {
    const { update, findBySlug, findByConditionId, scoreMarket } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    findBySlug.mockResolvedValue(null);
    findByConditionId.mockResolvedValue(null);

    await update.handleScore({ payload: "missing-market", reply } as ReplyContext);

    expect(scoreMarket).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("Маркет не найден. Попробуй другой slug или condition id.");
  });

  it("не роняет бота при ошибке score dependency", async () => {
    const { update, findBySlug } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    findBySlug.mockRejectedValue(new Error("db down"));

    await update.handleScore({ payload: "btc-100k", reply } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Не удалось оценить рынок. Попробуй позже.");
  });

  it("показывает top markets для выбора, если /score вызвали без аргумента", async () => {
    const { update, getScoreCandidates } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    getScoreCandidates.mockResolvedValue([
      {
        question: "Will BTC hit $100k?",
        market_slug: "btc-100k",
        condition_id: "condition-1",
        volume24hr: 250_000,
      } as Market,
    ]);

    await update.handleScore({ payload: "", chat: { id: 42 }, reply } as ReplyContext);

    expect(getScoreCandidates).toHaveBeenCalledWith(5);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Выбери рынок"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("/score 1"));
  });

  it("оценивает рынок по номеру из текущих score candidates", async () => {
    const { update, getScoreCandidates, findBySlug, scoreMarket } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    const market = {
      question: "Will BTC hit $100k?",
      market_slug: "btc-100k",
      condition_id: "condition-1",
      volume24hr: 250_000,
    } as Market;
    getScoreCandidates.mockResolvedValue([market]);
    findBySlug.mockResolvedValue(market);
    scoreMarket.mockReturnValue({
      score: 82,
      conclusion: "strong_watch",
      reasons: [],
      dataGaps: [],
      hasEnoughData: true,
    });

    await update.handleScore({ payload: "1", reply } as ReplyContext);

    expect(getScoreCandidates).toHaveBeenCalledWith(5);
    expect(findBySlug).toHaveBeenCalledWith("btc-100k");
    expect(reply).toHaveBeenLastCalledWith(expect.stringContaining("Score: 82/100"));
  });

  it("сообщает, если номер score candidate вне списка", async () => {
    const { update, getScoreCandidates, findBySlug } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    getScoreCandidates.mockResolvedValue([]);

    await update.handleScore({ payload: "1", reply } as ReplyContext);

    expect(findBySlug).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("Не вижу рынка под таким номером. Вызови /score и выбери номер из списка.");
  });

  it("не считает hex condition id номером score candidate", async () => {
    const { update, getScoreCandidates, findBySlug, findByConditionId, scoreMarket } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    const market = {
      question: "Will BTC hit $100k?",
      market_slug: "btc-100k",
      condition_id: "0x123",
      volume24hr: 250_000,
    } as Market;
    findBySlug.mockResolvedValue(null);
    findByConditionId.mockResolvedValue(market);
    scoreMarket.mockReturnValue({
      score: 82,
      conclusion: "strong_watch",
      reasons: [],
      dataGaps: [],
      hasEnoughData: true,
    });

    await update.handleScore({ payload: "0x123", reply } as ReplyContext);

    expect(getScoreCandidates).not.toHaveBeenCalled();
    expect(findBySlug).toHaveBeenCalledWith("0x123");
    expect(findByConditionId).toHaveBeenCalledWith("0x123");
    expect(reply).toHaveBeenLastCalledWith(expect.stringContaining("Score: 82/100"));
  });

  it("сообщает, если рынков для chooser пока нет", async () => {
    const { update, getScoreCandidates } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    getScoreCandidates.mockResolvedValue([]);

    await update.handleScore({ payload: "", reply } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Пока нет рынков для выбора. Попробуй /score <slug-or-condition_id>.");
  });

  it("не роняет бота при ошибке chooser dependency", async () => {
    const { update, getScoreCandidates } = createUpdate();
    const reply = vi.fn<(message: string) => void>();
    getScoreCandidates.mockRejectedValue(new Error("db down"));

    await update.handleScore({ payload: "", reply } as ReplyContext);

    expect(reply).toHaveBeenCalledWith("Не удалось получить список рынков. Попробуй /score <slug-or-condition_id>.");
  });

  it("handleTop вызывает getTopByScore(10) и отвечает HTML-сообщением", async () => {
    const { update, getTopByScore } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    // 10 кошельков — полный пул, admin alert не нужен
    getTopByScore.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeWalletScore(`0xABCDEF${i.toString().padStart(4, "0")}000000`)),
    );

    await update.handleTop({ reply } as ReplyContext);

    expect(getTopByScore).toHaveBeenCalledWith(10);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Smart Wallets"),
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("handleTop с пулом < 10 шлёт admin-алерт и не падает", async () => {
    const { update, getTopByScore, sendAdminAlert } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getTopByScore.mockResolvedValue([makeWalletScore(), makeWalletScore("0x1111222233334444")]);

    await update.handleTop({ reply } as ReplyContext);

    expect(sendAdminAlert).toHaveBeenCalledWith(expect.stringContaining("мало кандидатов"));
    expect(sendAdminAlert).toHaveBeenCalledWith(expect.stringContaining("2"));
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Smart Wallets"),
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("handleTop с 0 кошельков показывает заглушку и шлёт admin-алерт", async () => {
    const { update, getTopByScore, sendAdminAlert } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getTopByScore.mockResolvedValue([]);

    await update.handleTop({ reply } as ReplyContext);

    expect(sendAdminAlert).toHaveBeenCalledWith(expect.stringContaining("0"));
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("накапливаем данные"),
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("handleTop не падает если admin-алерт бросает ошибку", async () => {
    const { update, getTopByScore, sendAdminAlert } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getTopByScore.mockResolvedValue([makeWalletScore()]);
    sendAdminAlert.mockRejectedValue(new Error("telegram down"));

    // не должно бросить
    await expect(update.handleTop({ reply } as ReplyContext)).resolves.not.toThrow();
    expect(reply).toHaveBeenCalled();
  });

  it("отвечает smart whale whitelist для /whales", async () => {
    const { update, getActiveWhitelist } = createUpdate();
    const reply = vi.fn<(message: string, extra?: unknown) => void>();
    getActiveWhitelist.mockResolvedValue([
      {
        address: "0xabcdef1234567890",
        active: true,
        hit_rate: "0.650000",
        sum_pnl: "1234.56",
        roi_pct: "12.3000",
        whale_trade_count: 42,
        notes: "auto: score=1",
        source: "auto_scoring",
      },
    ]);

    await update.handleWhales({ reply } as ReplyContext);

    expect(getActiveWhitelist).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining("Smart Whale Whitelist"),
      expect.objectContaining({ parse_mode: "HTML", disable_web_page_preview: true }),
    );
  });

  it("/alerts on включает алерты и отвечает статусом", async () => {
    const { update, alertSettingsService } = createUpdate();
    const reply = vi.fn<(message: string) => void>();

    await update.handleAlerts({ payload: "on", chat: { id: Number(ADMIN_CHAT_ID) }, reply } as ReplyContext);

    expect(alertSettingsService.setAlertsEnabled).toHaveBeenCalledWith(true);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/вкл/i));
  });

  it("/alerts off выключает алерты", async () => {
    const { update, alertSettingsService } = createUpdate();
    const reply = vi.fn<(message: string) => void>();

    await update.handleAlerts({ payload: "off", chat: { id: Number(ADMIN_CHAT_ID) }, reply } as ReplyContext);

    expect(alertSettingsService.setAlertsEnabled).toHaveBeenCalledWith(false);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/выкл/i));
  });

  it("/alerts без аргумента показывает текущий статус", async () => {
    const { update, alertSettingsService } = createUpdate();
    alertSettingsService.isAlertsEnabled.mockResolvedValue(false);
    const reply = vi.fn<(message: string) => void>();

    await update.handleAlerts({ payload: "", chat: { id: Number(ADMIN_CHAT_ID) }, reply } as ReplyContext);

    expect(alertSettingsService.isAlertsEnabled).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/выкл/i));
  });

  describe("admin guard", () => {
    it("/queues не отвечает не-admin чату", async () => {
      const { update, queueStatsService } = createUpdate();
      const reply = vi.fn();

      await update.handleQueues({ chat: { id: 999 }, reply } as ReplyContext);

      expect(queueStatsService.getAllQueueCounts).not.toHaveBeenCalled();
      expect(reply).not.toHaveBeenCalled();
    });

    it("/queues отвечает admin чату", async () => {
      const { update, queueStatsService } = createUpdate();
      const reply = vi.fn();

      await update.handleQueues({ chat: { id: Number(ADMIN_CHAT_ID) }, reply } as ReplyContext);

      expect(queueStatsService.getAllQueueCounts).toHaveBeenCalled();
      expect(reply).toHaveBeenCalled();
    });

    it("/errors не отвечает не-admin чату", async () => {
      const { update, queueStatsService } = createUpdate();
      const reply = vi.fn();

      await update.handleErrors({ chat: { id: 999 }, reply } as ReplyContext);

      expect(queueStatsService.getRecentErrors).not.toHaveBeenCalled();
      expect(reply).not.toHaveBeenCalled();
    });

    it("/errors отвечает admin чату", async () => {
      const { update, queueStatsService } = createUpdate();
      const reply = vi.fn();

      await update.handleErrors({ chat: { id: Number(ADMIN_CHAT_ID) }, reply } as ReplyContext);

      expect(queueStatsService.getRecentErrors).toHaveBeenCalled();
      expect(reply).toHaveBeenCalled();
    });

    it("/ws не отвечает не-admin чату", async () => {
      const { update } = createUpdate();
      const reply = vi.fn();
      // tradeRepository не мокируется — не должен вызываться
      await update.handleWs({ chat: { id: 999 }, reply } as ReplyContext);

      expect(reply).not.toHaveBeenCalled();
    });

    it("/alerts не отвечает не-admin чату", async () => {
      const { update, alertSettingsService } = createUpdate();
      const reply = vi.fn();

      await update.handleAlerts({ payload: "", chat: { id: 999 }, reply } as ReplyContext);

      expect(alertSettingsService.isAlertsEnabled).not.toHaveBeenCalled();
      expect(reply).not.toHaveBeenCalled();
    });

    it("/alerts отвечает admin чату", async () => {
      const { update, alertSettingsService } = createUpdate();
      const reply = vi.fn();

      await update.handleAlerts({ payload: "", chat: { id: Number(ADMIN_CHAT_ID) }, reply } as ReplyContext);

      expect(alertSettingsService.isAlertsEnabled).toHaveBeenCalled();
      expect(reply).toHaveBeenCalled();
    });
  });
});
