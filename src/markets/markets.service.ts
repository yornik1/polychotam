import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { mapPolymarketMarket } from "./market.mapper.js";
import { MarketsResponseDto } from "./dto/markets-response.dto.js";
import { Market } from "./market.entity.js";
import {
  PolymarketInvalidPayloadError,
  PolymarketHttpClient,
  PolymarketHttpTimeoutError,
  PolymarketUpstreamStatusError,
} from "../polymarket/polymarket-http.client.js";
import { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw.js";

@Injectable()
export class MarketsService {
  private readonly logger = new Logger(MarketsService.name);

  constructor(
    @Inject(PolymarketHttpClient)
    private readonly polymarketHttpClient: Pick<PolymarketHttpClient, "fetchMarkets">,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
  ) {}

  async findBySlug(slug: string): Promise<Market | null> {
    return this.marketRepository.findOne({
      where: { market_slug: slug.trim() },
    });
  }

  async findByConditionId(conditionId: string): Promise<Market | null> {
    return this.marketRepository.findOne({
      where: { condition_id: conditionId.trim() },
    });
  }

  async getTopMarkets(limit = 20): Promise<Market[]> {
    return this.marketRepository
      .createQueryBuilder("market")
      .where("market.volume24hr > :minVolume", { minVolume: 100000 })
      .orderBy("market.volume24hr", "DESC")
      .limit(limit)
      .getMany();
  }

  async getScoreCandidates(limit = 20): Promise<Market[]> {
    return this.marketRepository
      .createQueryBuilder("market")
      .where("market.active = :active", { active: true })
      .andWhere("market.closed = :closed", { closed: false })
      .andWhere("market.accepting_orders = :acceptingOrders", { acceptingOrders: true })
      .andWhere("market.volume24hr > :minVolume", { minVolume: 0 })
      .andWhere("market.liquidity > :minLiquidity", { minLiquidity: 0 })
      .orderBy("market.volume24hr", "DESC")
      .limit(limit)
      .getMany();
  }

  async isTopMarket(conditionId: string, topLimit = 20): Promise<boolean> {
    const normalizedId = conditionId.trim();
    if (normalizedId.length === 0) {
      return false;
    }

    const topMarkets = await this.getTopMarkets(topLimit);
    return topMarkets.some((m) => m.condition_id === normalizedId);
  }

  async getMarkets(): Promise<MarketsResponseDto> {
    this.logger.log("Начинаю загрузку маркетов из Polymarket");

    try {
      const rawMarkets = await this.polymarketHttpClient.fetchMarkets();
      const data = this.mapRawMarkets(rawMarkets);
      const response: MarketsResponseDto = {
        data,
        meta: {
          source: "polymarket",
          total: data.length,
          fetchedAt: new Date().toISOString(),
        },
      };

      this.logger.log(`Успешно получены маркеты из Polymarket: ${data.length}`);
      return response;
    } catch (error: unknown) {
      this.rethrowAsHttpException(error);
    }
  }

  private mapRawMarkets(rawMarkets: PolymarketMarketRaw[]): MarketsResponseDto["data"] {
    if (!Array.isArray(rawMarkets)) {
      throw new PolymarketInvalidPayloadError("Polymarket markets payload is not an array");
    }

    const mapped: MarketsResponseDto["data"] = [];
    let skipped = 0;

    for (const rawMarket of rawMarkets) {
      if (rawMarket === null || typeof rawMarket !== "object") {
        throw new PolymarketInvalidPayloadError("Polymarket market item has invalid shape");
      }

      try {
        mapped.push(mapPolymarketMarket(rawMarket));
      } catch (error: unknown) {
        if (error instanceof PolymarketInvalidPayloadError) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    if (skipped > 0) {
      this.logger.warn(`Пропущено невалидных маркетов из upstream: ${skipped}`);
    }

    if (mapped.length === 0 && rawMarkets.length > 0) {
      throw new PolymarketInvalidPayloadError("Polymarket markets payload contains no valid markets");
    }

    return mapped;
  }

  private rethrowAsHttpException(error: unknown): never {
    if (this.isServiceUnavailableError(error)) {
      this.logger.warn(this.toLogMessage(error));
      throw new ServiceUnavailableException("Polymarket временно недоступен");
    }

    if (this.isBadGatewayError(error)) {
      this.logger.warn(this.toLogMessage(error));
      throw new BadGatewayException("Polymarket вернул ошибку шлюза");
    }

    this.logger.error(this.toLogMessage(error), this.toLogStack(error));
    throw new ServiceUnavailableException("Не удалось получить маркеты из Polymarket");
  }

  private isServiceUnavailableError(error: unknown): boolean {
    if (error instanceof PolymarketHttpTimeoutError || error instanceof PolymarketInvalidPayloadError) {
      return true;
    }

    if (error instanceof PolymarketUpstreamStatusError) {
      return error.statusCode === 429 || error.statusCode >= 500;
    }

    return false;
  }

  private isBadGatewayError(error: unknown): boolean {
    if (!(error instanceof PolymarketUpstreamStatusError)) {
      return false;
    }

    return error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429;
  }

  private toLogMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return "Неизвестная ошибка при запросе маркетов из Polymarket";
  }

  private toLogStack(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.stack;
    }

    return undefined;
  }
}
