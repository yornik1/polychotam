-- Resolution PnL для whale research (PostgreSQL, Polychotam).
-- Методика PnL: как WalletsService.recalculate (BUY/SELL × winning_token_id).
-- Выполняйте по одному запросу (каждый блок полностью самодостаточен).
-- Пороги: min_trade_usd и min_vol24 — как в prod whale (10k / 1M) или 10k / 100k для сравнения с coverage.

-- =============================================================================
-- QUERY 1 — диагностика: resolved universe, число сделок, whale vs non-whale count
-- =============================================================================
WITH params AS (
  SELECT
    10000::numeric AS min_trade_usd,
    1000000::double precision AS min_vol24,
    (NOW() - INTERVAL '90 days') AS since_ts
),
base_trades AS (
  SELECT
    t.market AS condition_id,
    t.maker_address,
    t.asset_id,
    UPPER(TRIM(t.side)) AS side,
    CAST(t.size AS numeric) AS size_n,
    CAST(t.price AS numeric) AS price_n,
    m.winning_token_id
  FROM trades t
  INNER JOIN markets m ON m.condition_id = t.market
  CROSS JOIN params p
  WHERE t.match_time >= p.since_ts
    AND m.closed = TRUE
    AND m.winning_token_id IS NOT NULL
    AND m.volume24hr > p.min_vol24
    AND t.maker_address IS NOT NULL
    AND BTRIM(t.maker_address) <> ''
    AND LOWER(t.maker_address) <> 'unknown'
    AND UPPER(TRIM(t.side)) IN ('BUY', 'SELL')
),
pnl_all AS (
  SELECT
    *,
    (size_n * price_n) AS notional_usdc,
    (size_n * price_n > (SELECT min_trade_usd FROM params)) AS is_whale,
    CASE
      WHEN side = 'BUY' AND (asset_id = winning_token_id) THEN size_n * (1 - price_n)
      WHEN side = 'BUY' AND NOT (asset_id = winning_token_id) THEN -size_n * price_n
      WHEN side = 'SELL' AND (asset_id = winning_token_id) THEN -size_n * (1 - price_n)
      WHEN side = 'SELL' AND NOT (asset_id = winning_token_id) THEN size_n * price_n
    END AS resolution_pnl_usdc
  FROM base_trades
)
SELECT
  COUNT(DISTINCT condition_id) AS resolved_markets_in_universe,
  COUNT(*) AS trades_total,
  SUM(CASE WHEN is_whale THEN 1 ELSE 0 END) AS trades_whale_notional,
  SUM(CASE WHEN NOT is_whale THEN 1 ELSE 0 END) AS trades_non_whale_notional,
  COUNT(*) FILTER (WHERE resolution_pnl_usdc IS NULL) AS trades_pnl_null
FROM pnl_all;

-- =============================================================================
-- QUERY 2 — baseline: hit_rate и PnL whale_notional vs non_whale (тот же universe)
-- =============================================================================
WITH params AS (
  SELECT
    10000::numeric AS min_trade_usd,
    1000000::double precision AS min_vol24,
    (NOW() - INTERVAL '90 days') AS since_ts
),
base_trades AS (
  SELECT
    t.maker_address,
    t.asset_id,
    UPPER(TRIM(t.side)) AS side,
    CAST(t.size AS numeric) AS size_n,
    CAST(t.price AS numeric) AS price_n,
    m.winning_token_id
  FROM trades t
  INNER JOIN markets m ON m.condition_id = t.market
  CROSS JOIN params p
  WHERE t.match_time >= p.since_ts
    AND m.closed = TRUE
    AND m.winning_token_id IS NOT NULL
    AND m.volume24hr > p.min_vol24
    AND t.maker_address IS NOT NULL
    AND BTRIM(t.maker_address) <> ''
    AND LOWER(t.maker_address) <> 'unknown'
    AND UPPER(TRIM(t.side)) IN ('BUY', 'SELL')
),
pnl_all AS (
  SELECT
    *,
    (size_n * price_n) AS notional_usdc,
    (size_n * price_n > (SELECT min_trade_usd FROM params)) AS is_whale,
    CASE
      WHEN side = 'BUY' AND (asset_id = winning_token_id) THEN size_n * (1 - price_n)
      WHEN side = 'BUY' AND NOT (asset_id = winning_token_id) THEN -size_n * price_n
      WHEN side = 'SELL' AND (asset_id = winning_token_id) THEN -size_n * (1 - price_n)
      WHEN side = 'SELL' AND NOT (asset_id = winning_token_id) THEN size_n * price_n
    END AS resolution_pnl_usdc
  FROM base_trades
)
SELECT
  CASE WHEN is_whale THEN 'whale_notional' ELSE 'non_whale_notional' END AS cohort,
  COUNT(*) AS n_trades,
  ROUND(
    (SUM(CASE WHEN resolution_pnl_usdc > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)),
    4
  ) AS hit_rate_positive_pnl,
  ROUND(AVG(resolution_pnl_usdc)::numeric, 6) AS avg_resolution_pnl_usdc,
  ROUND(SUM(resolution_pnl_usdc)::numeric, 2) AS sum_resolution_pnl_usdc,
  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolution_pnl_usdc)::numeric,
    6
  ) AS median_pnl_usdc
FROM pnl_all
WHERE resolution_pnl_usdc IS NOT NULL
GROUP BY is_whale
ORDER BY is_whale DESC;

-- =============================================================================
-- QUERY 3 — топ кошельков по суммарному resolution PnL (только whale-notional)
-- =============================================================================
WITH params AS (
  SELECT
    10000::numeric AS min_trade_usd,
    1000000::double precision AS min_vol24,
    (NOW() - INTERVAL '90 days') AS since_ts
),
base_trades AS (
  SELECT
    t.maker_address,
    t.asset_id,
    UPPER(TRIM(t.side)) AS side,
    CAST(t.size AS numeric) AS size_n,
    CAST(t.price AS numeric) AS price_n,
    m.winning_token_id
  FROM trades t
  INNER JOIN markets m ON m.condition_id = t.market
  CROSS JOIN params p
  WHERE t.match_time >= p.since_ts
    AND m.closed = TRUE
    AND m.winning_token_id IS NOT NULL
    AND m.volume24hr > p.min_vol24
    AND t.maker_address IS NOT NULL
    AND BTRIM(t.maker_address) <> ''
    AND LOWER(t.maker_address) <> 'unknown'
    AND UPPER(TRIM(t.side)) IN ('BUY', 'SELL')
),
pnl_all AS (
  SELECT
    *,
    (size_n * price_n) AS notional_usdc,
    (size_n * price_n > (SELECT min_trade_usd FROM params)) AS is_whale,
    CASE
      WHEN side = 'BUY' AND (asset_id = winning_token_id) THEN size_n * (1 - price_n)
      WHEN side = 'BUY' AND NOT (asset_id = winning_token_id) THEN -size_n * price_n
      WHEN side = 'SELL' AND (asset_id = winning_token_id) THEN -size_n * (1 - price_n)
      WHEN side = 'SELL' AND NOT (asset_id = winning_token_id) THEN size_n * price_n
    END AS resolution_pnl_usdc
  FROM base_trades
)
SELECT
  maker_address,
  COUNT(*) AS whale_trade_count,
  ROUND(SUM(resolution_pnl_usdc)::numeric, 2) AS sum_resolution_pnl_usdc,
  ROUND(AVG(resolution_pnl_usdc)::numeric, 6) AS avg_resolution_pnl_usdc,
  ROUND(
    (SUM(CASE WHEN resolution_pnl_usdc > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)),
    4
  ) AS hit_rate_positive_pnl
FROM pnl_all
WHERE is_whale
  AND resolution_pnl_usdc IS NOT NULL
GROUP BY maker_address
HAVING COUNT(*) >= 5
ORDER BY sum_resolution_pnl_usdc DESC
LIMIT 50;

-- =============================================================================
-- Охват БД vs on-chain: после QUERY 1–3 выполните вручную, например:
--   SELECT COUNT(*) FROM trades WHERE match_time >= NOW() - INTERVAL '7 days';
-- и сравните с Bitquery из node scripts/research/polymarket-coverage-research.mjs
-- при наличии BITQUERY_TOKEN в .env.
-- =============================================================================
--
-- Ограничения: markets.volume24hr — снимок на момент синка, не на match_time.
-- Для min_vol24 = 100000 продублируйте QUERY 1–3, изменив params.min_vol24.
