import { ConfigService } from "@nestjs/config";
import { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { DataSourceOptions } from "typeorm";
import { join } from "path";

type ParsedDbUrl = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
};

function parseDatabaseUrl(databaseUrl: string): ParsedDbUrl {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace("/", ""),
    ssl: parsed.searchParams.get("sslmode") === "require"
  };
}

export function getDataSourceOptions(databaseUrl: string): DataSourceOptions {
  const parsed = parseDatabaseUrl(databaseUrl);
  return {
    type: "postgres",
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    database: parsed.database,
    ssl: parsed.ssl ? { rejectUnauthorized: false } : false,
    entities: [join(__dirname, "..", "**", "*.entity{.ts,.js}")],
    migrations: [join(__dirname, "..", "migrations", "*{.ts,.js}")],
    synchronize: false
  };
}

export function buildTypeOrmConfig(
  configService: ConfigService
): TypeOrmModuleOptions {
  const databaseUrl = configService.getOrThrow<string>("DATABASE_URL");
  return {
    ...getDataSourceOptions(databaseUrl),
    autoLoadEntities: true, // NestJS specific
  };
}
