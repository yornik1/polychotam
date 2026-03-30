import { ConfigService } from "@nestjs/config";
import { TypeOrmModuleOptions } from "@nestjs/typeorm";

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

export function buildTypeOrmConfig(
  configService: ConfigService
): TypeOrmModuleOptions {
  const databaseUrl = configService.getOrThrow<string>("DATABASE_URL");
  const parsed = parseDatabaseUrl(databaseUrl);

  return {
    type: "postgres",
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    database: parsed.database,
    ssl: parsed.ssl,
    autoLoadEntities: true,
    synchronize: false
  };
}
