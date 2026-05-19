import { Injectable } from "@nestjs/common";

/**
 * Статус WS-клиента для команды /ws.
 * PolymarketWsClient вызывает setConnected/recordReconnect, чтобы данные были видны снаружи.
 */
@Injectable()
export class PolymarketWsStatusService {
  private connected = false;
  private subscribedAssets = 0;
  private reconnects: number[] = [];

  setConnected(connected: boolean, subscribedAssets?: number): void {
    this.connected = connected;
    if (typeof subscribedAssets === "number") {
      this.subscribedAssets = subscribedAssets;
    }
  }

  recordReconnect(): void {
    const now = Date.now();
    this.reconnects.push(now);
    // Чистим старше 24 часов
    const cutoff = now - 24 * 60 * 60 * 1000;
    this.reconnects = this.reconnects.filter((t) => t >= cutoff);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSubscribedAssets(): number {
    return this.subscribedAssets;
  }

  getReconnectsLast24h(): number {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return this.reconnects.filter((t) => t >= cutoff).length;
  }
}
