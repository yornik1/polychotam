import { MarketDto } from "./dto/market.dto";
import { PolymarketMarketRaw } from "../polymarket/dto/polymarket-market.raw";
import { PolymarketInvalidPayloadError } from "../polymarket/polymarket-http.client";

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

function assertNumberField(value: unknown, fieldName: string): number {
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

function assertOutcomesField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new PolymarketInvalidPayloadError('Polymarket market field "outcomes" must be an array');
  }

  const hasInvalidOutcome = value.some((item: unknown) => typeof item !== "string");
  if (hasInvalidOutcome) {
    throw new PolymarketInvalidPayloadError(
      'Polymarket market field "outcomes" must contain only strings'
    );
  }

  return value;
}

function assertNormalizedIsoDateField(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PolymarketInvalidPayloadError(
      'Polymarket market field "endDate" must be a valid date string or null'
    );
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new PolymarketInvalidPayloadError(
      'Polymarket market field "endDate" must be a valid date string or null'
    );
  }

  return parsedDate.toISOString();
}

export function mapPolymarketMarket(raw: PolymarketMarketRaw): MarketDto {
  return {
    id: assertNonEmptyStringField(raw.id, "id"),
    slug: assertNonEmptyStringField(raw.slug, "slug"),
    question: assertNonEmptyStringField(raw.question, "question"),
    outcomes: assertOutcomesField(raw.outcomes),
    active: assertBooleanField(raw.active, "active"),
    closed: assertBooleanField(raw.closed, "closed"),
    liquidity: assertNumberField(raw.liquidity, "liquidity"),
    volume24h: assertNumberField(raw.volume24h, "volume24h"),
    endDate: assertNormalizedIsoDateField(raw.endDate),
  };
}
