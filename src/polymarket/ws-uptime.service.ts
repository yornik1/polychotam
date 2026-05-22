import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, MoreThanOrEqual, Repository } from "typeorm";
import { WsConnectionEvent } from "./ws-connection-event.entity.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Uptime WS к CLOB: события в БД + текущее подключение в памяти. */
@Injectable()
export class WsUptimeService implements OnModuleInit {
  private readonly logger = new Logger(WsUptimeService.name);
  private currentConnectedAt: Date | null = null;

  constructor(
    @InjectRepository(WsConnectionEvent)
    private readonly eventRepository: Repository<WsConnectionEvent>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.closeDanglingOpenFromPreviousProcess();
  }

  /** После SIGKILL/краша последнее событие может остаться open — закрываем, иначе 24h uptime завышается. */
  private async closeDanglingOpenFromPreviousProcess(): Promise<void> {
    const [last] = await this.eventRepository.find({
      order: { at: "DESC" },
      take: 1,
    });
    if (last?.kind !== "open") {
      return;
    }
    const at = new Date();
    await this.eventRepository.save({ kind: "close", at });
    this.logger.warn(
      "WS: последнее событие в БД было open без close (вероятно аварийный выход); дописан synthetic close",
    );
  }

  getElapsedMs(): number {
    if (this.currentConnectedAt === null) {
      return 0;
    }
    return Math.max(0, Date.now() - this.currentConnectedAt.getTime());
  }

  async markOpen(): Promise<void> {
    if (this.currentConnectedAt !== null) {
      return;
    }
    const at = new Date();
    this.currentConnectedAt = at;
    await this.eventRepository.save({ kind: "open", at });
  }

  async markClose(): Promise<void> {
    if (this.currentConnectedAt === null) {
      return;
    }
    this.currentConnectedAt = null;
    const at = new Date();
    await this.eventRepository.save({ kind: "close", at });
  }

  /** Доля времени «вверху» за последние 24 часа [0, 1]. */
  async getUptimeRatio24h(): Promise<number> {
    const now = Date.now();
    const windowStart = new Date(now - WINDOW_MS);

    const lastBefore = await this.eventRepository.findOne({
      where: { at: LessThan(windowStart) },
      order: { at: "DESC" },
    });

    const inWindow = await this.eventRepository.find({
      where: { at: MoreThanOrEqual(windowStart) },
      order: { at: "ASC" },
    });

    let inUp = lastBefore?.kind === "open";
    let t = windowStart.getTime();
    let upMs = 0;

    for (const ev of inWindow) {
      const evT = ev.at.getTime();
      if (inUp) {
        upMs += Math.max(0, evT - t);
      }
      if (ev.kind === "open") {
        inUp = true;
        t = evT;
      } else {
        inUp = false;
        t = evT;
      }
    }

    if (inUp) {
      upMs += Math.max(0, now - t);
    }

    return Math.min(1, upMs / WINDOW_MS);
  }
}
