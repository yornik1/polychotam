import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { MarketSyncService } from "./markets/market-sync.service.js";

/**
 * Одноразовый бэкфилл закрытых маркетов из Gamma keyset → таблица `markets`
 * (в т.ч. `winning_token_id` там, где Gamma отдаёт корректные `outcomePrices`).
 *
 * Env:
 *   BACKFILL_GAMMA_CLOSED_MAX_PAGES (по умолчанию 2000)
 *   BACKFILL_GAMMA_CLOSED_PAGE_SIZE (по умолчанию 500, макс 1000)
 *
 * Требует доступной БД и (как у всего AppModule) REDIS для Bull — поднимайте stack или задайте совместимый REDIS_URL.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger("BackfillGammaClosed");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  const maxPages = parsePositiveInt(process.env.BACKFILL_GAMMA_CLOSED_MAX_PAGES, 2000);
  const pageSize = parsePositiveInt(process.env.BACKFILL_GAMMA_CLOSED_PAGE_SIZE, 500);

  try {
    const sync = app.get(MarketSyncService);
    const result = await sync.backfillClosedMarketsFromGammaKeyset({
      maxPages,
      pageSize,
    });
    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

void bootstrap();
