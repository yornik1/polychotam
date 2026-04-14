/**
 * Путь к NDJSON: дублируем чтение из process.env (compose env_file → process.env),
 * если ConfigService не отдал значение; убираем кавычки и пробелы.
 */
export function resolveBullJobErrorsLogPathRaw(
  fromConfig: string | undefined,
): string | undefined {
  const trimmedConfig = fromConfig === undefined ? "" : fromConfig.trim();
  const rawSource =
    trimmedConfig.length > 0
      ? trimmedConfig
      : process.env.BULL_JOB_ERRORS_LOG_PATH;
  if (rawSource === undefined) {
    return undefined;
  }
  let t = rawSource.trim();
  if (t.length === 0) {
    return "";
  }
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}
