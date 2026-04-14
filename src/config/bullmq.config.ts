import { BullRootModuleOptions } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import type { ConnectionOptions } from "bullmq";

export function buildBullMqConnection(
  configService: ConfigService,
): ConnectionOptions {
  const redisUrl = configService.getOrThrow<string>("REDIS_URL");
  const parsed = new URL(redisUrl);

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

export function buildBullMqConfig(
  configService: ConfigService,
): BullRootModuleOptions {
  return {
    connection: buildBullMqConnection(configService),
  };
}
