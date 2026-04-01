import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import WebSocket from "ws";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { pickTopMarketsByVolume } from "./polymarket-top-markets.js";
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

    this.logger.debug(`Raw WS message: ${rawData}`);

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
        `Сделка: кошелёк=${walletLabel}, сумма=${trade.amount}, маркет=${trade.market}, актив=${trade.assetId}, сторона=${trade.side}, цена=${trade.price}`
      );
    }
  }

  private async runFullConnectCycle(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.teardownSocket();

    let assetIds: string[];
    try {
      const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
      assetIds = pickTopMarketsByVolume(rawMarkets, 20);
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
        assets_ids: assetIds,
        type: "market",
      };
      socket.send(JSON.stringify(payload));
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
