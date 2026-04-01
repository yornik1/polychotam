import { MarketDto } from "./dto/market.dto.js";
import { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw.js";
import { PolymarketInvalidPayloadError } from "../polymarket/polymarket-http.client.js";

function assertNonEmptyStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new PolymarketInvalidPayloadError(`Polymarket market field "${fieldName}" must be a string`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new PolymarketInvalidPayloadError(
      `Polymarket market field "${fieldName}" must be a non-empty string`
    );
  }

  return normalized;
}

function assertBooleanField(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  throw new PolymarketInvalidPayloadError(
    `Polymarket market field "${fieldName}" must be a boolean or string boolean`
  );
}

function assertNumberField(
  value: unknown,
  fieldName: string,
  options?: { defaultWhenMissing?: number }
): number {
  if (
    options?.defaultWhenMissing !== undefined &&
    (value === null || value === undefined || value === "")
  ) {
    return options.defaultWhenMissing;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new PolymarketInvalidPayloadError(
    `Polymarket market field "${fieldName}" must be a number or numeric string`
  );
}

/**
 * Извлекает outcomes из массива tokens.
 * Каждый токен — объект с полем outcome: string.
 */
function assertOutcomesFromTokens(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) {
    throw new PolymarketInvalidPayloadError('Polymarket market field "tokens" must be an array');
  }

  return tokens.map((token: unknown, i: number) => {
    if (typeof token !== "object" || token === null) {
      throw new PolymarketInvalidPayloadError(
        `Polymarket market tokens[${i}] must be an object`
      );
    }

    const outcome = (token as Record<string, unknown>).outcome;
    if (typeof outcome !== "string" || outcome.trim() === "") {
      throw new PolymarketInvalidPayloadError(
        `Polymarket market tokens[${i}].outcome must be a non-empty string`
      );
    }

    return outcome;
  });
}

function assertNormalizedIsoDateField(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PolymarketInvalidPayloadError(
      'Polymarket market field "end_date_iso" must be a valid date string or null'
    );
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new PolymarketInvalidPayloadError(
      'Polymarket market field "end_date_iso" must be a valid date string or null'
    );
  }

  return parsedDate.toISOString();
}

export function mapPolymarketMarket(raw: PolymarketMarketRaw): MarketDto {
  return {
    id: assertNonEmptyStringField(raw.condition_id, "condition_id"),
    slug: assertNonEmptyStringField(raw.market_slug, "market_slug"),
    question: assertNonEmptyStringField(raw.question, "question"),
    outcomes: assertOutcomesFromTokens(raw.tokens),
    active: assertBooleanField(raw.active, "active"),
    closed: assertBooleanField(raw.closed, "closed"),
    // В актуальном CLOB API поля liquidity/volume24hr могут отсутствовать.
    // Для стабильного DTO-контракта в MVP используем безопасный fallback 0.
    liquidity: assertNumberField(raw.liquidity, "liquidity", { defaultWhenMissing: 0 }),
    volume24h: assertNumberField(raw.volume24hr, "volume24hr", { defaultWhenMissing: 0 }),
    endDate: assertNormalizedIsoDateField(raw.end_date_iso),
  };
}
