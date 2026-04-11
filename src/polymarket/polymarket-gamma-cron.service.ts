import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MarketSyncService } from "../markets/market-sync.service.js";
import type { GammaMarketRaw } from "./dto/gamma-market.raw.js";
import { PolymarketHttpClient } from "./polymarket-http.client.js";
import { gammaConditionId } from "./polymarket-gamma.util.js";
import { PolymarketMarketResolutionService } from "./polymarket-market-resolution.service.js";

function dedupeGammaMarketsByCondition(
  markets: readonly GammaMarketRaw[],
): GammaMarketRaw[] {
  const map = new Map<string, GammaMarketRaw>();
  for (const market of markets) {
    const cid = gammaConditionId(market);
    if (cid !== null) {
      map.set(cid, market);
    }
  }
  return [...map.values()];
}

@Injectable()
export class GammaMarketCronService {
  private readonly logger = new Logger(GammaMarketCronService.name);

  constructor(
    private readonly polymarketHttpClient: PolymarketHttpClient,
    private readonly marketSyncService: MarketSyncService,
    private readonly marketResolutionService: PolymarketMarketResolutionService,
  ) {}

  /** Каждые 5 минут: актуальные и недавно закрытые маркеты из Gamma, пересчёт кошельков при новом исходе. */
  @Cron("0 */5 * * * *")
  async syncGammaMarketsJob(): Promise<void> {
    try {
      const active =
        await this.polymarketHttpClient.fetchActiveMarketsFromGamma(100);
      const resolved =
        await this.polymarketHttpClient.fetchRecentlyResolvedMarketsFromGamma(
          40,
        );
      const merged = dedupeGammaMarketsByCondition([...resolved, ...active]);
      const newlyResolved =
        await this.marketSyncService.upsertGammaMarketsAndCollectNewlyResolved(
          merged,
        );
      for (const conditionId of newlyResolved) {
        await this.marketResolutionService.enqueueWalletRecalcForMarketTraders(
          conditionId,
        );
      }
      if (newlyResolved.length > 0) {
        this.logger.log(
          `Крон Gamma: новый исход у ${newlyResolved.length} маркет(ов), поставлен пересчёт кошельков`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Неизвестная ошибка";
      this.logger.warn(`Крон Gamma: ${message}`);
    }
  }
}
