import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import WebSocket from "ws";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { buildTopMarketsWsSelection } from "./polymarket-top-markets.js";
import { parseTradeEventsFromWsPayload } from "./polymarket-ws-trade.parser.js";

/** Полный цикл после ошибки HTTP/обрыва WS (спека). */
const RECONNECT_MS = 5000;
/** Heartbeat market/user channel (дока Polymarket CLOB WebSocket). */
const PING_INTERVAL_MS = 10_000;

@Injectable()
export class PolymarketWsClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PolymarketWsClient.name);
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  /** Сколько первых сырых кадров показать уровнем LOG (остальные — debug). */
  private rawLogSamplesLeft = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly polymarketHttpClient: PolymarketHttpClient
  ) {}

  onModuleInit(): void {
    void this.runFullConnectCycle();
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
      this.logger.debug("WS сырой кадр: [] (пустой массив от upstream, часто сразу после подписки)");
    } else if (this.rawLogSamplesLeft > 0) {
      this.rawLogSamplesLeft -= 1;
      const preview = rawData.length > 800 ? `${rawData.slice(0, 797)}...` : rawData;
      this.logger.log(`WS сырой кадр (пример): ${preview}`);
    } else {
      this.logger.debug(`WS сырой кадр: ${rawData.length > 400 ? `${rawData.slice(0, 397)}...` : rawData}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData) as unknown;
    } catch {
      this.logger.warn("Не удалось распарсить WS сообщение как JSON");
      return;
    }

    const trades = parseTradeEventsFromWsPayload(parsed);
    for (const trade of trades) {
      const walletLabel = trade.wallet.length > 0 ? trade.wallet : "—";
      this.logger.log(
        `Сделка: кошелёк=${walletLabel}, сумма=${trade.amount}, маркет=${trade.market} | актив=${trade.assetId}, сторона=${trade.side}, цена=${trade.price}`
      );
    }
  }

  private async runFullConnectCycle(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.teardownSocket();

    let assetIds: readonly string[] = [];
    try {
      const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
      const selection = buildTopMarketsWsSelection(rawMarkets, 20);
      assetIds = selection.assetIds;

      this.logger.log(
        `Топ-${selection.rows.length} маркетов (объём 24h с CLOB /markets + приоритет торгуемости); уникальных assets_ids: ${assetIds.length}`
      );
      if (selection.rows.length > 0 && selection.rows.every((r) => r.volume24hr === 0)) {
        this.logger.warn(
          "У выбранных рынков объём 24h = 0: в ответе CLOB /markets поля объёма обычно нет — «топ по объёму» недоступен без другого API (например Gamma). Сортировка: приоритет accepting_orders / active / closed."
        );
      }
      for (const row of selection.rows) {
        this.logger.log(
          `  #${row.rank} vol24h=${row.volume24hr} tradePri=${row.tradabilityScore} condition_id=${row.conditionId} slug=${row.slug} token_id=[${row.tokenIds.join(", ")}]`
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.error(`Ошибка загрузки маркетов для WS: ${message}`);
      this.scheduleReconnect();
      return;
    }

    if (assetIds.length === 0) {
      this.logger.warn("Нет token_id для подписки (топ-20 маркетов пустой после фильтрации)");
      this.scheduleReconnect();
      return;
    }

    const wsUrl = this.configService.getOrThrow<string>("POLYMARKET_WS_URL");

    this.logger.log(`Подключение к Polymarket CLOB WS: ${wsUrl}`);

    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.on("open", () => {
      this.logger.log("WS подключился к Polymarket CLOB");
      // Подписка market channel: поле assets_ids — clob token_id (дока Polymarket).
      const payload = {
        assets_ids: [...assetIds],
        type: "market",
      };
      const subscribeJson = JSON.stringify(payload);
      this.logger.log(
        `Отправка подписки market channel: type=market, assets_ids.length=${assetIds.length}`
      );
      this.logger.log(`Тело подписки (сырой JSON): ${subscribeJson.length > 1200 ? `${subscribeJson.slice(0, 1197)}...` : subscribeJson}`);
      this.rawLogSamplesLeft = 5;
      socket.send(subscribeJson);
      this.startPing(socket);
    });

    socket.on("message", (data) => {
      this.handleMessage(data);
    });

    socket.on("close", (code, reason) => {
      this.stopPing();
      const reasonText = reason.length > 0 ? reason.toString() : "";
      this.logger.warn(`WS закрыт (code=${code}${reasonText ? `, reason=${reasonText}` : ""}). Переподключение через ${RECONNECT_MS} мс`);
      this.scheduleReconnect();
    });

    socket.on("error", (error: Error) => {
      this.logger.error(`WS ошибка: ${error.message}`);
    });
  }
}
