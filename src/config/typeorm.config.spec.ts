import { ConfigService } from "@nestjs/config";
import { describe, it, expect, vi } from "vitest";
import { buildTypeOrmConfig, getDataSourceOptions } from "./typeorm.config";

describe("TypeORM Configuration", () => {
  it("should parse database URL correctly", () => {
    const databaseUrl = "postgresql://user:pass@localhost:5432/mydb";
    const options = getDataSourceOptions(databaseUrl) as any;

    expect(options.type).toBe("postgres");
    expect(options.host).toBe("localhost");
    expect(options.port).toBe(5432);
    expect(options.username).toBe("user");
    expect(options.password).toBe("pass");
    expect(options.database).toBe("mydb");
    expect(options.synchronize).toBe(false);
  });

  it("should handle sslmode=require", () => {
    const databaseUrl = "postgresql://user:pass@host:5432/db?sslmode=require";
    const options = getDataSourceOptions(databaseUrl) as any;

    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("should generate TypeOrmModule options", () => {
    const mockConfigService = {
      getOrThrow: vi.fn().mockReturnValue("postgresql://u:p@h:5432/d")
    } as unknown as ConfigService;

    const options = buildTypeOrmConfig(mockConfigService) as any;

    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith("DATABASE_URL");
    expect(options.autoLoadEntities).toBe(true);
    expect(options.synchronize).toBe(false);
  });
});
