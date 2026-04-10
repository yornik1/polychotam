import { DataSource } from "typeorm";
import { getDataSourceOptions } from "./config/typeorm.config.js";
import { ConfigService } from "@nestjs/config";
import { config } from "dotenv";

config({ path: [".env", ".env.local"] });

const configService = new ConfigService();
const databaseUrl = configService.getOrThrow<string>("DATABASE_URL");

export const AppDataSource = new DataSource(getDataSourceOptions(databaseUrl));
