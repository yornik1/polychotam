import { Logger, Module, type INestApplicationContext } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { buildTypeOrmConfig } from "./config/typeorm.config.js";
import { ENV_FILE_PATHS } from "./config/env-files.js";
import { parseBoolean, parsePositiveInt } from "./refresh-smart-wallets.cli.util.js";
import { TradesModule } from "./trades/trades.module.js";
import { UnknownTradeRepairService } from "./trades/unknown-trade-repair.service.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [...ENV_FILE_PATHS],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildTypeOrmConfig(configService),
    }),
    TradesModule,
  ],
})
class RepairUnknownTradesCliModule {}

async function bootstrap(): Promise<void> {
  const logger = new Logger("RepairUnknownTrades");
  let app: INestApplicationContext | null = null;

  try {
    app = await NestFactory.createApplicationContext(RepairUnknownTradesCliModule, {
      logger: ["error", "warn", "log"],
    });

    const configService = app.get(ConfigService);
    const repairService = app.get(UnknownTradeRepairService);
    const limit = parsePositiveInt(
      configService.get<string>("UNKNOWN_TRADES_REPAIR_LIMIT"),
      100,
      "UNKNOWN_TRADES_REPAIR_LIMIT",
    );
    const dryRun = parseBoolean(
      configService.get<string>("UNKNOWN_TRADES_REPAIR_DRY_RUN"),
      false,
      "UNKNOWN_TRADES_REPAIR_DRY_RUN",
    );
    const delayMs = parsePositiveInt(
      configService.get<string>("UNKNOWN_TRADES_REPAIR_DELAY_MS"),
      200,
      "UNKNOWN_TRADES_REPAIR_DELAY_MS",
    );
    const order =
      configService.get<string>("UNKNOWN_TRADES_REPAIR_ORDER") === "recent"
        ? "recent"
        : "whale";

    const result = await repairService.repairBatch({ limit, dryRun, delayMs, order });
    logger.log(JSON.stringify({ ...result, dryRun }, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    logger.error(`Unknown trade repair failed: ${message}`);
    process.exitCode = 1;
  } finally {
    if (app !== null) {
      await app.close();
    }
  }
}

void bootstrap();
