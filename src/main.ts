import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Чтобы PolymarketWsClient писал сырые кадры через Logger.debug
    logger: ["error", "warn", "log", "debug"],
  });
  await app.listen(3000);
}

void bootstrap();
