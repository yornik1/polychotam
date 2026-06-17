export function parseBoolean(raw: string | undefined, fallback: boolean, envName: string): boolean {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${envName} must be a boolean-like value`);
}

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number | undefined,
  envName: string,
): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const normalized = raw.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${envName} must be a positive integer`);
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return value;
}

export function parsePositiveNumber(
  raw: string | undefined,
  fallback: number | undefined,
  envName: string,
): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${envName} must be a positive number`);
  }

  return value;
}
