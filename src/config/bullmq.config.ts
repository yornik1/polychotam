import { ConfigService } from "@nestjs/config";
import { BullRootModuleOptions } from "@nestjs/bullmq";

export function buildBullMqConfig(
  configService: ConfigService
): BullRootModuleOptions {
  const redisUrl = configService.getOrThrow<string>("REDIS_URL");
  const parsed = new URL(redisUrl);

  return {
    connection: {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined
    }
  };
}
