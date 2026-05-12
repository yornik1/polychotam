# TASK: Whale Predictive Value — Iteration 2 (расширение выборки)

> **Для Cursor Composer / агента:** это автономная задача. Выполняй последовательно, фиксируй числа, не меняй src/ без явной необходимости. Результат — файл `scripts/research/whale-predictive-value-iteration2-results.md`.

## Цель

Расширить resolved universe в БД (маркеты с `winning_token_id`) и повторить whale resolution backtest с бо́льшим N, чтобы получить статистически значимый ответ: есть ли у крупных сделок (≥ $10k) преимущество по hit rate / PnL над baseline.

## Предварительные условия

- `docker compose up -d` (postgres, redis, app должны быть подняты)
- БД `polychotam` доступна через `docker compose exec -T postgres psql -U postgres -d polychotam`

## Шаги

---

### Шаг 1: Проверить текущее состояние resolved маркетов

```bash
docker compose exec -T postgres psql -U postgres -d polychotam -c \
  "SELECT COUNT(*) AS resolved_markets FROM markets WHERE closed = TRUE AND winning_token_id IS NOT NULL;"
```

Запиши число. Это baseline до backfill.

---

### Шаг 2: Backfill закрытых маркетов из Gamma

**Вариант A (если `npm run backfill:gamma-closed` работает):**

```bash
npm run build && node dist/backfill-gamma-closed.main.js
```

Env (опционально): `BACKFILL_GAMMA_CLOSED_MAX_PAGES=2000 BACKFILL_GAMMA_CLOSED_PAGE_SIZE=500`

**Вариант B (если Вариант A падает — метод не реализован):**

Метод `backfillClosedMarketsFromGammaKeyset` может отсутствовать в `MarketSyncService`. В этом случае реализуй его:

```typescript
// В src/markets/market-sync.service.ts добавь метод:

async backfillClosedMarketsFromGammaKeyset(opts: {
  maxPages: number;
  pageSize: number;
}): Promise<{ pagesProcessed: number; marketsUpserted: number; newlyResolved: string[] }> {
  const allNewlyResolved: string[] = [];
  let cursor: string | undefined;
  let pagesProcessed = 0;
  let marketsUpserted = 0;

  for (let page = 0; page < opts.maxPages; page += 1) {
    const url = this.buildGammaKeysetUrl(cursor, opts.pageSize, true);
    const response = await fetch(url);
    if (!response.ok) {
      break;
    }
    const payload = (await response.json()) as { markets?: unknown[]; next_cursor?: string };
    const markets = payload.markets;
    if (!Array.isArray(markets) || markets.length === 0) {
      break;
    }

    const gammaMarkets = markets as GammaMarketRaw[];
    const newlyResolved = await this.upsertGammaMarketsAndCollectNewlyResolved(gammaMarkets);
    allNewlyResolved.push(...newlyResolved);
    marketsUpserted += gammaMarkets.length;
    pagesProcessed += 1;

    const nextCursor = payload.next_cursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) {
      break;
    }
    if (markets.length < opts.pageSize) {
      break;
    }
    cursor = nextCursor;

    // Rate limit
    await new Promise((r) => setTimeout(r, 300));
  }

  return { pagesProcessed, marketsUpserted, newlyResolved: allNewlyResolved };
}

private buildGammaKeysetUrl(cursor: string | undefined, limit: number, closed: boolean): string {
  const base = "https://gamma-api.polymarket.com/markets/keyset";
  const params = new URLSearchParams({
    closed: String(closed),
    limit: String(Math.min(limit, 1000)),
  });
  if (cursor) {
    params.set("after_cursor", cursor);
  }
  return `${base}?${params}`;
}
```

Также добавь import `GammaMarketRaw` если не импортирован. Затем:

```bash
npm run build && node dist/backfill-gamma-closed.main.js
```

**Вариант C (самый простой — прямой SQL через Gamma API без приложения):**

Если оба варианта выше слишком сложны, напиши одноразовый скрипт:

```bash
cat > /tmp/backfill-gamma-resolved.mjs << 'EOF'
import { execSync } from "node:child_process";

const GAMMA_KEYSET = "https://gamma-api.polymarket.com/markets/keyset";
const MAX_PAGES = 200;
const PAGE_SIZE = 500;

function parseClobTokenIds(raw) {
  if (Array.isArray(raw)) return raw.filter(x => typeof x === "string" && x.trim().length > 0);
  if (typeof raw === "string") { try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(x => typeof x === "string") : []; } catch { return []; } }
  return [];
}

function parseOutcomePrices(raw) {
  if (Array.isArray(raw)) return raw.map(x => Number(x));
  if (typeof raw === "string") { try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(x => Number(x)) : []; } catch { return []; } }
  return [];
}

function deriveWinningTokenId(market) {
  const tokens = parseClobTokenIds(market.clobTokenIds);
  const prices = parseOutcomePrices(market.outcomePrices);
  if (tokens.length === 0 || prices.length !== tokens.length) return null;
  let bestIdx = -1, bestPrice = -1;
  for (let i = 0; i < prices.length; i++) {
    if (Number.isFinite(prices[i]) && prices[i] > bestPrice) { bestPrice = prices[i]; bestIdx = i; }
  }
  if (bestIdx < 0 || bestPrice < 0.5) return null;
  return tokens[bestIdx] ?? null;
}

async function main() {
  let cursor;
  let totalUpserted = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ closed: "true", limit: String(PAGE_SIZE) });
    if (cursor) params.set("after_cursor", cursor);
    const res = await fetch(`${GAMMA_KEYSET}?${params}`);
    if (!res.ok) { console.error(`HTTP ${res.status}`); break; }
    const payload = await res.json();
    const markets = payload.markets;
    if (!Array.isArray(markets) || markets.length === 0) break;

    const values = [];
    for (const m of markets) {
      const cid = (m.conditionId ?? m.condition_id ?? "").trim();
      if (!cid) continue;
      const winToken = deriveWinningTokenId(m);
      if (!winToken) continue;
      const question = (m.question ?? "").replace(/'/g, "''").slice(0, 500);
      const slug = (m.slug ?? m.market_slug ?? `gamma-${cid.slice(0,16)}`).replace(/'/g, "''");
      const vol = Number(m.volume24hr) || 0;
      values.push(`('${cid}', '${question}', '${slug}', '${winToken}', TRUE, FALSE, ${vol}, NOW())`);
    }

    if (values.length > 0) {
      const sql = `INSERT INTO markets (condition_id, question, market_slug, winning_token_id, closed, active, volume24hr, internal_synced_at)
VALUES ${values.join(",\n")}
ON CONFLICT (condition_id) DO UPDATE SET
  winning_token_id = COALESCE(EXCLUDED.winning_token_id, markets.winning_token_id),
  closed = TRUE,
  internal_synced_at = NOW();`;
      try {
        execSync(`docker compose exec -T postgres psql -U postgres -d polychotam -c "${sql.replace(/"/g, '\\"')}"`, { stdio: "pipe" });
        totalUpserted += values.length;
      } catch (e) {
        // Fallback: write to file and exec
        const { writeFileSync } = await import("node:fs");
        writeFileSync("/tmp/gamma-upsert.sql", sql);
        execSync(`docker compose exec -T postgres psql -U postgres -d polychotam -f /dev/stdin < /tmp/gamma-upsert.sql`, { stdio: "pipe" });
        totalUpserted += values.length;
      }
    }

    console.error(`Page ${page + 1}: ${markets.length} markets, ${values.length} with winning_token_id`);
    const nextCursor = payload.next_cursor;
    if (!nextCursor || markets.length < PAGE_SIZE) break;
    cursor = nextCursor;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`Done. Upserted ${totalUpserted} resolved markets.`);
}

main().catch(e => { console.error(e); process.exit(1); });
EOF
node /tmp/backfill-gamma-resolved.mjs
```

После любого варианта — снова проверь:

```bash
docker compose exec -T postgres psql -U postgres -d polychotam -c \
  "SELECT COUNT(*) AS resolved_markets FROM markets WHERE closed = TRUE AND winning_token_id IS NOT NULL;"
```

**Цель: ≥ 50 resolved маркетов. Если < 50 — зафиксируй "insufficient resolved data" и остановись.**

---

### Шаг 3: Прогнать whale-resolution-backtest.sql (4 комбинации)

Файл: `scripts/research/whale-resolution-backtest.sql`

Прогони все 3 QUERY как есть (90d, vol24 > 1M):

```bash
docker compose exec -T postgres psql -U postgres -d polychotam < scripts/research/whale-resolution-backtest.sql
```

Затем повтори с модификациями (замени значения в CTE `params`):

| Комбинация | Период | min_vol24 |
|------------|--------|-----------|
| A | 90 days | 1000000 |
| B | 90 days | 100000 |
| C | 365 days | 1000000 |
| D | 365 days | 100000 |

Для каждой зафиксируй из QUERY 1 и QUERY 2:
- `resolved_markets_in_universe`
- `trades_total`, `trades_whale_notional`
- `hit_rate_positive_pnl` (whale vs non-whale)
- `avg_resolution_pnl_usdc`, `median_pnl_usdc`

---

### Шаг 4: Z-score (формальный тест)

Для каждой комбинации где `trades_whale_notional ≥ 30`, выполни:

```sql
WITH params AS (
  SELECT
    10000::numeric AS min_trade_usd,
    100000::double precision AS min_vol24,  -- подставь нужное
    (NOW() - INTERVAL '365 days') AS since_ts  -- подставь нужное
),
base_trades AS (
  SELECT
    t.maker_address, t.asset_id,
    UPPER(TRIM(t.side)) AS side,
    CAST(t.size AS numeric) AS size_n,
    CAST(t.price AS numeric) AS price_n,
    m.winning_token_id
  FROM trades t
  INNER JOIN markets m ON m.condition_id = t.market
  CROSS JOIN params p
  WHERE t.match_time >= p.since_ts
    AND m.closed = TRUE AND m.winning_token_id IS NOT NULL
    AND m.volume24hr > p.min_vol24
    AND t.maker_address IS NOT NULL AND BTRIM(t.maker_address) <> '' AND LOWER(t.maker_address) <> 'unknown'
    AND UPPER(TRIM(t.side)) IN ('BUY', 'SELL')
),
pnl_all AS (
  SELECT *,
    (size_n * price_n) AS notional_usdc,
    (size_n * price_n > (SELECT min_trade_usd FROM params)) AS is_whale,
    CASE
      WHEN side = 'BUY' AND asset_id = winning_token_id THEN size_n * (1 - price_n)
      WHEN side = 'BUY' AND asset_id != winning_token_id THEN -size_n * price_n
      WHEN side = 'SELL' AND asset_id = winning_token_id THEN -size_n * (1 - price_n)
      WHEN side = 'SELL' AND asset_id != winning_token_id THEN size_n * price_n
    END AS resolution_pnl_usdc
  FROM base_trades
),
stats AS (
  SELECT
    SUM(CASE WHEN is_whale AND resolution_pnl_usdc > 0 THEN 1 ELSE 0 END) AS whale_wins,
    SUM(CASE WHEN is_whale THEN 1 ELSE 0 END) AS whale_n,
    SUM(CASE WHEN NOT is_whale AND resolution_pnl_usdc > 0 THEN 1 ELSE 0 END) AS base_wins,
    SUM(CASE WHEN NOT is_whale THEN 1 ELSE 0 END) AS base_n
  FROM pnl_all WHERE resolution_pnl_usdc IS NOT NULL
)
SELECT
  whale_wins, whale_n,
  ROUND(whale_wins::numeric / NULLIF(whale_n, 0), 4) AS whale_hr,
  base_wins, base_n,
  ROUND(base_wins::numeric / NULLIF(base_n, 0), 4) AS base_hr,
  ROUND(((whale_wins + base_wins)::numeric / NULLIF(whale_n + base_n, 0)), 4) AS pooled_p,
  CASE WHEN whale_n > 0 AND base_n > 0 THEN
    ROUND(
      ((whale_wins::float / whale_n - base_wins::float / base_n) /
      SQRT(
        ((whale_wins + base_wins)::float / (whale_n + base_n)) *
        (1 - (whale_wins + base_wins)::float / (whale_n + base_n)) *
        (1.0 / whale_n + 1.0 / base_n)
      ))::numeric, 4)
  END AS z_score
FROM stats;
```

**Интерпретация:** z > 1.645 → p < 0.05 (односторонний тест, H1: whale лучше). z > 1.96 → p < 0.025.

---

### Шаг 5: QUERY 3 — топ кошельков

Прогони QUERY 3 из `whale-resolution-backtest.sql` для лучшей комбинации по N (скорее всего 365d + vol24 100k). Зафиксируй top-20.

Дополнительно:

```sql
-- Сколько «smart whales» с разными порогами:
WITH ... (тот же CTE что QUERY 3) ...
SELECT
  COUNT(*) FILTER (WHERE hit_rate_positive_pnl > 0.65 AND whale_trade_count >= 10) AS smart_strict,
  COUNT(*) FILTER (WHERE hit_rate_positive_pnl > 0.55 AND whale_trade_count >= 20) AS smart_loose,
  COUNT(*) FILTER (WHERE hit_rate_positive_pnl > 0.60 AND whale_trade_count >= 5) AS smart_mid
FROM (
  -- подставь QUERY 3 как подзапрос
) sub;
```

---

### Шаг 6: Записать результаты

Создай файл `scripts/research/whale-predictive-value-iteration2-results.md`:

```markdown
# Whale Predictive Value — Iteration 2 Results

## Дата прогона
[YYYY-MM-DD]

## Resolved universe
- До backfill: [число] resolved маркетов
- После backfill: [число] resolved маркетов
- Метод backfill: [Вариант A/B/C]

## Результаты

### Комбинация A: 90d + vol24 > 1M
| Метрика | Whale (≥$10k) | Non-whale |
|---------|---------------|-----------|
| N trades | | |
| Hit rate PnL>0 | | |
| Avg PnL USDC | | |
| Median PnL USDC | | |
| Sum PnL USDC | | |

Resolved маркетов в universe: [число]
Z-score: [число] | p < 0.05: [да/нет]

### Комбинация B: 90d + vol24 > 100k
[аналогично]

### Комбинация C: 365d + vol24 > 1M
[аналогично]

### Комбинация D: 365d + vol24 > 100k
[аналогично]

## Топ-20 кошельков (QUERY 3, комбинация [X])

| # | maker_address | whale_trades | sum_pnl | hit_rate |
|---|---------------|-------------|---------|----------|
| 1 | | | | |
...

## Smart whale cluster
- hit_rate > 0.65, trades ≥ 10: [число] кошельков
- hit_rate > 0.60, trades ≥ 5: [число] кошельков
- hit_rate > 0.55, trades ≥ 20: [число] кошельков

## Decision

**Лучшая комбинация по N:** [какая]
**Z-score:** [число]
**p-value (односторонний):** [< 0.05 / > 0.05]

**H0 (whale trades не лучше baseline):**
- [ ] Не отвергнута (edge не подтверждён)
- [ ] Отвергнута (edge подтверждён)

**Вывод (выбрать одно):**
- [ ] "Edge подтверждён: whale hit rate значимо выше baseline"
- [ ] "Edge частичный: только подгруппа smart whales показывает устойчивый результат"
- [ ] "Edge не подтверждён: разница статистически не значима даже при расширенной выборке"
- [ ] "Insufficient data: resolved маркетов < 50 даже после backfill"

**Рекомендация для продукта:**
[1-3 предложения: что это значит для whale alerts — оставить как info feed, добавить smart scoring, или отказаться]

## Ограничения
- volume24hr — снимок на момент синка, не на дату сделки
- win_rate не учитывает sizing (маленькие winning + большие losing = positive HR, negative PnL)
- Нет учёта кластеризации адресов (один игрок — несколько кошельков)
- Resolution PnL не учитывает cost of capital / time value
```

---

### Шаг 7: Коммит

```bash
git add scripts/research/whale-predictive-value-iteration2-results.md
git commit -m "research: whale predictive value iteration 2 — extended resolved universe"
```

---

## Правила для агента

1. **НЕ меняй `src/`** кроме случая когда Вариант A backfill не работает (тогда реализуй метод минимально)
2. **НЕ создавай миграции**
3. **НЕ трогай package.json**
4. Все SQL через `docker compose exec -T postgres psql -U postgres -d polychotam`
5. Если backfill падает — попробуй Вариант C (одноразовый скрипт)
6. Если resolved маркетов < 50 после всех попыток — зафиксируй "insufficient data" и закончи
7. Числа записывай точно как выдал psql, не округляй руками
8. Decision — строго по z-score, не по ощущениям
