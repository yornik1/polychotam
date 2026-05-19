import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import WebSocket from "ws";
import type { TradeEvent } from "./dto/trade-event.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { PolymarketMarketResolutionService } from "./polymarket-market-resolution.service.js";
import { buildTopMarketsWsSelectionFromGamma } from "./polymarket-gamma-top-markets.js";
import { buildTopMarketsWsSelection } from "./polymarket-top-markets.js";
import { tryParseMarketResolvedWsPayload } from "./polymarket-ws-resolved.parser.js";
import { parseTradeEventsFromWsPayload } from "./polymarket-ws-trade.parser.js";
import {
  TRADES_JOB_PROCESS,
  TRADES_QUEUE_NAME,
} from "../queue/trades-queue.config.js";
import { WsUptimeService } from "./ws-uptime.service.js";

/** Полный цикл после ошибки HTTP/обрыва WS (спека). */
const RECONNECT_MS = 5000;
/** Heartbeat market/user channel (дока Polymarket CLOB WebSocket). */
const PING_INTERVAL_MS = 10_000;

@Injectable()
export class PolymarketWsClient implements OnModuleDestroy {
  private readonly logger = new Logger(PolymarketWsClient.name);
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  /** Сколько первых сырых кадров показать уровнем LOG (остальные — debug). */
  private rawLogSamplesLeft = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly polymarketHttpClient: PolymarketHttpClient,
    private readonly marketResolutionService: PolymarketMarketResolutionService,
    private readonly wsUptimeService: WsUptimeService,
    @InjectQueue(TRADES_QUEUE_NAME)
    private readonly tradesQueue: Queue<TradeEvent>,
  ) {}

  async connect(assetIds?: readonly string[]): Promise<void> {
    await this.runFullConnectCycle(assetIds);
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) {
      return;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.runFullConnectCycle();
    }, RECONNECT_MS);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startPing(socket: WebSocket): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send("PING");
      }
    }, PING_INTERVAL_MS);
  }

  private teardownSocket(): void {
    this.stopPing();
    if (this.ws === null) {
      return;
    }
    void this.wsUptimeService.markClose();
    const old = this.ws;
    this.ws = null;
    old.removeAllListeners();
    old.close();
  }

  private handleMessage(data: WebSocket.RawData): void {
    const rawData = typeof data === "string" ? data : data.toString();
    const trimmed = rawData.trim();
    if (trimmed === "PONG") {
      return;
    }

    const isEmptyJsonArray = trimmed === "[]";
    if (isEmptyJsonArray) {
      this.logger.debug(
        "WS сырой кадр: [] (пустой массив от upstream, часто сразу после подписки)",
      );
    } else if (this.rawLogSamplesLeft > 0) {
      this.rawLogSamplesLeft -= 1;
      const preview = rawData.length > 800 ? `${rawData.slice(0, 797)}...` : rawData;
      this.logger.log(`WS сырой кадр (пример): ${preview}`);
    } else {
      this.logger.debug(
        `WS сырой кадр: ${rawData.length > 400 ? `${rawData.slice(0, 397)}...` : rawData}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData) as unknown;
    } catch {
      this.logger.warn("Не удалось распарсить WS сообщение как JSON");
      return;
    }

    this.dispatchParsedWsPayload(parsed);
  }

  private dispatchParsedWsPayload(parsed: unknown): void {
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        this.dispatchParsedWsPayload(item);
      }
      return;
    }

    const resolved = tryParseMarketResolvedWsPayload(parsed);
    if (resolved !== null) {
      void this.marketResolutionService
        .applyMarketResolvedFromWs({
          conditionId: resolved.conditionId,
          winningAssetId: resolved.winningAssetId,
          winningOutcome: resolved.winningOutcome,
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "Неизвестная ошибка";
          this.logger.error(`market_resolved: не удалось применить: ${message}`);
        });
      return;
    }

    const trades = parseTradeEventsFromWsPayload(parsed);
    for (const trade of trades) {
      const walletLabel = trade.wallet.length > 0 ? trade.wallet : "—";
      this.logger.log(
        `Сделка: кошелёк=${walletLabel}, сумма=${trade.amount}, маркет=${trade.market} | актив=${trade.assetId}, сторона=${trade.side}, цена=${trade.price}`,
      );
      void this.tradesQueue.add(TRADES_JOB_PROCESS, trade).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Неизвестная ошибка";
        this.logger.error(`Не удалось поставить сделку в очередь: ${message}`);
      });
    }
  }

  private async runFullConnectCycle(
    initialAssetIds?: readonly string[],
  ): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.teardownSocket();

    let assetIds: readonly string[] = initialAssetIds ?? [];
    if (assetIds.length === 0) {
      try {
        const gammaMarkets =
          await this.polymarketHttpClient.fetchActiveMarketsFromGamma(20);
        const selection = buildTopMarketsWsSelectionFromGamma(gammaMarkets, 20);
        assetIds = selection.assetIds;

        this.logger.log(
          `Топ-${selection.rows.length} маркетов (Gamma API по volume24h); уникальных assets_ids: ${assetIds.length}`,
        );
        for (const row of selection.rows) {
          this.logger.log(
            `  #${row.rank} vol24h=${row.volume24hr} tradePri=${row.tradabilityScore} condition_id=${row.conditionId} slug=${row.slug} token_id=[${row.tokenIds.join(", ")}]`,
          );
        }
      } catch (errorGamma: unknown) {
        const gammaMessage =
          errorGamma instanceof Error ? errorGamma.message : "Неизвестная ошибка";
        this.logger.warn(
          `Gamma API недоступен (${gammaMessage}), fallback на CLOB /markets`,
        );
        try {
          const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
          const selection = buildTopMarketsWsSelection(rawMarkets, 20);
          assetIds = selection.assetIds;
          this.logger.log(
            `Топ-${selection.rows.length} маркетов (fallback CLOB); уникальных assets_ids: ${assetIds.length}`,
          );
          for (const row of selection.rows) {
            this.logger.log(
              `  #${row.rank} vol24h=${row.volume24hr} tradePri=${row.tradabilityScore} condition_id=${row.conditionId} slug=${row.slug} token_id=[${row.tokenIds.join(", ")}]`,
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Неизвестная ошибка";
          this.logger.error(`Ошибка загрузки маркетов для WS: ${message}`);
          this.scheduleReconnect();
          return;
        }
      }
    } else {
      this.logger.log(
        `Использую предрассчитанный набор assets_ids для startup WS: ${assetIds.length}`,
      );
    }

    if (assetIds.length === 0) {
      this.logger.warn(
        "Нет token_id для подписки (топ-20 маркетов пустой после фильтрации)",
      );
      this.scheduleReconnect();
      return;
    }

    const wsUrl = this.configService.getOrThrow<string>("POLYMARKET_WS_URL");

    this.logger.log(`Подключение к Polymarket CLOB WS: ${wsUrl}`);

    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.on("open", () => {
      void this.wsUptimeService.markOpen().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Неизвестная ошибка";
        this.logger.error(`ws uptime markOpen: ${message}`);
      });
      this.logger.log("WS подключился к Polymarket CLOB");
      // Подписка market channel: поле assets_ids — clob token_id (дока Polymarket).
      const payload = {
        assets_ids: [...assetIds],
        type: "market",
        custom_feature_enabled: true,
      };
      const subscribeJson = JSON.stringify(payload);
      this.logger.log(
        `Отправка подписки market channel: type=market, assets_ids.length=${assetIds.length}`,
      );
      this.logger.log(
        `Тело подписки (сырой JSON): ${subscribeJson.length > 1200 ? `${subscribeJson.slice(0, 1197)}...` : subscribeJson}`,
      );
      this.rawLogSamplesLeft = 5;
      socket.send(subscribeJson);
      this.startPing(socket);
    });

    socket.on("message", (data) => {
      this.handleMessage(data);
    });

    socket.on("close", (code, reason) => {
      void this.wsUptimeService.markClose().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Неизвестная ошибка";
        this.logger.error(`ws uptime markClose: ${message}`);
      });
      this.stopPing();
      const reasonText = reason.length > 0 ? reason.toString() : "";
      this.logger.warn(
        `WS закрыт (code=${code}${reasonText ? `, reason=${reasonText}` : ""}). Переподключение через ${RECONNECT_MS} мс`,
      );
      this.scheduleReconnect();
    });

    socket.on("error", (error: Error) => {
      this.logger.error(`WS ошибка: ${error.message}`);
      void this.wsUptimeService.markClose().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка";
        this.logger.error(`ws uptime markClose после error: ${message}`);
      });
      this.scheduleReconnect();
    });
  }
}
