import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBullJobErrorsLogPathRaw } from "./bull-job-error-log.env.js";

describe("resolveBullJobErrorsLogPathRaw", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("берёт из process.env если config пуст", () => {
    vi.stubEnv("BULL_JOB_ERRORS_LOG_PATH", "  logs/x.ndjson  ");
    expect(resolveBullJobErrorsLogPathRaw(undefined)).toBe("logs/x.ndjson");
  });

  it("приоритет у непустого значения из config", () => {
    vi.stubEnv("BULL_JOB_ERRORS_LOG_PATH", "from-env");
    expect(resolveBullJobErrorsLogPathRaw("from-config")).toBe("from-config");
  });

  it("пустой config отдаёт env", () => {
    vi.stubEnv("BULL_JOB_ERRORS_LOG_PATH", "only-env");
    expect(resolveBullJobErrorsLogPathRaw("   ")).toBe("only-env");
  });

  it("снимает обрамляющие кавычки", () => {
    vi.stubEnv("BULL_JOB_ERRORS_LOG_PATH", "");
    expect(resolveBullJobErrorsLogPathRaw('"logs/a.ndjson"')).toBe("logs/a.ndjson");
  });
});
