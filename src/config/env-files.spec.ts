import { describe, expect, it } from "vitest";
import { ENV_FILE_PATHS } from "./env-files.js";

describe("ENV_FILE_PATHS", () => {
  it("ставит .env.local раньше .env, чтобы локальные значения имели приоритет", () => {
    expect(ENV_FILE_PATHS).toEqual([".env.local", ".env"]);
  });
});
