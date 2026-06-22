import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("docker-compose.prod.yml", () => {
  it("настраивает Redis без eviction для BullMQ", () => {
    const compose = readFileSync(
      join(process.cwd(), "docker-compose.prod.yml"),
      "utf8",
    );

    expect(compose).toContain("--maxmemory 96mb");
    expect(compose).toContain("--maxmemory-policy noeviction");
    expect(compose).not.toContain("--maxmemory-policy allkeys-lru");
  });
});
