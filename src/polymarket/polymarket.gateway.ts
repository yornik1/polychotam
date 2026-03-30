import { WebSocketGateway } from "@nestjs/websockets";

// Точка расширения для внутренних WebSocket-событий приложения.
@WebSocketGateway()
export class PolymarketGateway {}
