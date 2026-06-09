import { Logger, type INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import {
  parseBoolean,
  parsePositiveInt,
  parsePositiveNumber,
} from "./refresh-smart-wallets.cli.util.js";
import { SmartWalletsService } from "./wallets/smart-wallets.service.js";

async function bootstrap(): Promise<void> {
  const logger = new Logger("RefreshSmartWallets");
  let app: INestApplicationContext | null = null;

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn", "log"],
    });

    const configService = app.get(ConfigService);
    const smartWalletsService = app.get(SmartWalletsService);
    const dryRun = parseBoolean(
      configService.get<string>("SMART_WALLETS_REFRESH_DRY_RUN"),
      false,
      "SMART_WALLETS_REFRESH_DRY_RUN",
    );

    const result = await smartWalletsService.refreshSmartWallets({
      dryRun,
      freshnessDays: parsePositiveInt(
        configService.get<string>("SMART_WALLETS_REFRESH_FRESHNESS_DAYS"),
        undefined,
        "SMART_WALLETS_REFRESH_FRESHNESS_DAYS",
      ),
      minResolvedTrades: parsePositiveInt(
        configService.get<string>("SMART_WALLETS_REFRESH_MIN_RESOLVED_TRADES"),
        undefined,
        "SMART_WALLETS_REFRESH_MIN_RESOLVED_TRADES",
      ),
      minWinRate: parsePositiveNumber(
        configService.get<string>("SMART_WALLETS_REFRESH_MIN_WIN_RATE"),
        undefined,
        "SMART_WALLETS_REFRESH_MIN_WIN_RATE",
      ),
      minTotalRisk: parsePositiveNumber(
        configService.get<string>("SMART_WALLETS_REFRESH_MIN_TOTAL_RISK"),
        undefined,
        "SMART_WALLETS_REFRESH_MIN_TOTAL_RISK",
      ),
      minSelectedForDeactivation: parsePositiveInt(
        configService.get<string>("SMART_WALLETS_REFRESH_MIN_SELECTED_FOR_DEACTIVATION"),
        undefined,
        "SMART_WALLETS_REFRESH_MIN_SELECTED_FOR_DEACTIVATION",
      ),
      limit: parsePositiveInt(
        configService.get<string>("SMART_WALLETS_REFRESH_LIMIT"),
        undefined,
        "SMART_WALLETS_REFRESH_LIMIT",
      ),
    });

    logger.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    logger.error(`Smart wallet refresh failed: ${message}`);
    process.exitCode = 1;
  } finally {
    if (app !== null) {
      await app.close();
    }
  }
}
void bootstrap();
