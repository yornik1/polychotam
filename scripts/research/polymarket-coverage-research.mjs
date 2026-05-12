#!/usr/bin/env node
/**
 * Одноразовое исследование покрытия маркетов Polymarket (Gamma полный список,
 * проба Bitquery/Data API, упрощённая оценка при недоступности on-chain).
 * Запуск: node scripts/research/polymarket-coverage-research.mjs
 * Env: BITQUERY_TOKEN (опционально)
 */
/* eslint-disable no-console */

import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
  quiet: true,
});
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
  override: true,
  quiet: true,
});

/** Offset `/markets` на больших смещениях даёт 500; активно keyset: docs.polymarket.com. */
const GAMMA_KEYSET = "https://gamma-api.polymarket.com/markets/keyset";

function num(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normMarket(m) {
  const volume24hr = num(m.volume24hr);
  const liquidity = Math.max(num(m.liquidity), num(m.liquidityNum));
  const lifetimeVolume = num(m.volume ?? m.volumeNum);
  const cid =
    typeof m.conditionId === "string"
      ? m.conditionId.trim()
      : typeof m.condition_id === "string"
        ? m.condition_id.trim()
        : "";
  const question = typeof m.question === "string" ? m.question : "";
  const id = m.id ?? "";
  return {
    id,
    question,
    volume24hr,
    volume: lifetimeVolume,
    liquidity,
    conditionId: cid,
  };
}

const FETCH_TIMEOUT_MS = 60_000;

async function fetchWithRetry(url, maxAttempts = 5) {
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal:
          typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
            ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
            : undefined,
      });
      if (res.ok) {
        return res;
      }
      lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 280)}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  throw new Error(lastErr);
}

async function fetchGammaKeysetPayload(cursor, limit) {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(limit),
  });
  if (cursor) {
    params.set("after_cursor", cursor);
  }
  const url = `${GAMMA_KEYSET}?${params}`;
  const res = await fetchWithRetry(url);
  const payload = await res.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("Gamma keyset: некорректный JSON");
  }
  return payload;
}

async function fetchAllActiveMarkets() {
  const limitFallbacks = [1000, 500, 250, 100, 50];
  let cursor;
  let page = 0;
  const all = [];
  for (;;) {
    /** На границах курсора Gamma иногда отдаёт 500 — уменьшаем limit. */
    let payload = null;
    let usedLimit = 1000;
    let lastErr = "";
    for (const lim of limitFallbacks) {
      try {
        payload = await fetchGammaKeysetPayload(cursor, lim);
        usedLimit = lim;
        lastErr = "";
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        console.error(`Gamma keyset: HTTP после ретраев (limit=${lim}): ${lastErr.slice(0, 120)}`);
      }
    }
    if (!payload) {
      throw new Error(`Gamma keyset: не удалось получить страницу: ${lastErr}`);
    }
    const batch = payload.markets;
    if (!Array.isArray(batch)) {
      throw new Error("Gamma keyset: ожидался payload.markets (массив)");
    }
    page += 1;
    console.error(`Gamma keyset страница ${page}: получено ${batch.length} (limit=${usedLimit})`);
    for (const m of batch) {
      all.push(normMarket(m));
    }
    const nextCursor = payload.next_cursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) {
      break;
    }
    if (batch.length < usedLimit) {
      break;
    }
    cursor = nextCursor;
  }
  return all;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sumVol24(where) {
  return where.reduce((s, m) => s + m.volume24hr, 0);
}

/**
 * Структура ответа Bitquery вариативна: EVM объект или массив; PredictionTrades — объект или массив строк.
 */
function extractBitqueryPredictionAgg(bodyText) {
  const j = JSON.parse(bodyText);
  if (Array.isArray(j.errors) && j.errors.length > 0) {
    return { errors: j.errors, agg: null };
  }
  const evm = j?.data?.EVM;
  if (evm == null) {
    return { agg: null };
  }
  const row = Array.isArray(evm) ? evm[0] ?? null : evm;
  if (row == null) {
    return { agg: null };
  }
  let pt = row.PredictionTrades;
  if (Array.isArray(pt)) {
    pt = pt[0] ?? null;
  }
  return { agg: pt };
}

async function probeBitquery(sinceIso) {
  const token = process.env.BITQUERY_TOKEN?.trim();
  const query = `{
    EVM(network: matic, dataset: realtime) {
      PredictionTrades(
        where: {
          Block: { Time: { since: "${sinceIso}" } }
          TransactionStatus: { Success: true }
          Trade: {
            Prediction: {
              Marketplace: { ProtocolName: { is: "polymarket" } }
            }
          }
        }
      ) {
        count
        volume_usd: sum(of: Trade_OutcomeTrade_CollateralAmountInUSD)
      }
    }
  }`;

  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch("https://streaming.bitquery.io/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text, hadToken: Boolean(token) };
}

async function probeDataApi(path) {
  const url = `https://data-api.polymarket.com${path}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    return {
      path,
      status: res.status,
      sampleKeys:
        Array.isArray(json) && json[0] && typeof json[0] === "object"
          ? Object.keys(json[0]).slice(0, 20)
          : json && typeof json === "object" && !Array.isArray(json)
            ? Object.keys(json).slice(0, 20)
            : null,
    };
  } catch (e) {
    return { path, error: e instanceof Error ? e.message : String(e) };
  }
}

function main() {
  return (async () => {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");

    console.error("Загрузка Gamma…");
    const markets = await fetchAllActiveMarkets();

    const totalMarketsCount = markets.length;
    const totalVolume24hAll = sumVol24(markets);

    const above1m = markets.filter((m) => m.volume24hr >= 1_000_000);
    const above100k = markets.filter((m) => m.volume24hr >= 100_000);
    const above10k = markets.filter((m) => m.volume24hr >= 10_000);

    const totalVolume24Above1m = sumVol24(above1m);
    const totalVolume24Above100k = sumVol24(above100k);
    const totalVolume24Above10k = sumVol24(above10k);

    const coverageByVolumePct =
      totalVolume24hAll > 0
        ? round2((totalVolume24Above1m / totalVolume24hAll) * 100)
        : 0;
    const coverage100kPct =
      totalVolume24hAll > 0
        ? round2((totalVolume24Above100k / totalVolume24hAll) * 100)
        : 0;
    const coverage10kPct =
      totalVolume24hAll > 0
        ? round2((totalVolume24Above10k / totalVolume24hAll) * 100)
        : 0;

    const top10Vol24 = [...markets]
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 10)
      .map((m) => ({
        question: m.question.slice(0, 200),
        volume24hr: round2(m.volume24hr),
        conditionId: m.conditionId,
      }));

    const top5Gap = markets
      .filter((m) => m.volume24hr >= 100_000 && m.volume24hr < 1_000_000)
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 5)
      .map((m) => ({
        question: m.question.slice(0, 200),
        volume24hr: round2(m.volume24hr),
        conditionId: m.conditionId,
      }));

    const top10Lifetime = [...markets]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10)
      .map((m) => ({
        question: m.question.slice(0, 200),
        volume: round2(m.volume),
        volume24hr: round2(m.volume24hr),
        conditionId: m.conditionId,
      }));

    /** Высокая ликвидность, низкий vol24 (< 1M) — кандидаты «маркет-мейкер / неактивный день». */
    const liquidityAnomalies = markets
      .filter((m) => m.liquidity > 500_000 && m.volume24hr < 1_000_000)
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, 15)
      .map((m) => ({
        question: m.question.slice(0, 120),
        liquidity: round2(m.liquidity),
        volume24hr: round2(m.volume24hr),
        conditionId: m.conditionId,
      }));

    const avgVol24 = totalMarketsCount > 0 ? totalVolume24hAll / totalMarketsCount : 0;
    const gammaFallbackLowerBoundTradeVolume = round2(
      avgVol24 * totalMarketsCount,
    );

    const top20Ws = [...markets]
      .sort((a, b) => b.volume24hr - a.volume24hr)
      .slice(0, 20);
    const vol24Top20 = round2(sumVol24(top20Ws));
    const pctTop20Ws =
      totalVolume24hAll > 0
        ? round2((vol24Top20 / totalVolume24hAll) * 100)
        : 0;

    console.error("Bitquery…");
    const bq = await probeBitquery(since7d);

    let totalTrades7dOnchain = null;
    let totalVolume7dOnchainUsd = null;
    let source = "Bitquery недоступен без токена";
    let onchainNotes = "";

    if (bq.ok) {
      try {
        const parsed = extractBitqueryPredictionAgg(bq.body);
        if (parsed.errors) {
          onchainNotes = `Bitquery GraphQL errors: ${JSON.stringify(parsed.errors).slice(0, 400)}`;
        }
        const agg = parsed.agg;
        if (agg) {
          if (agg.count != null) {
            const c = Number(agg.count);
            if (Number.isFinite(c)) {
              totalTrades7dOnchain = c;
            }
          }
          if (agg.volume_usd != null) {
            const v = Number(agg.volume_usd);
            if (Number.isFinite(v)) {
              totalVolume7dOnchainUsd = round2(v);
            }
          }
        }
        if (totalTrades7dOnchain != null || totalVolume7dOnchainUsd != null) {
          source = "Bitquery";
        } else if (!onchainNotes) {
          onchainNotes = `Bitquery: нет agg в ответе: ${bq.body.slice(0, 400)}`;
        }
      } catch {
        onchainNotes = `Bitquery ответ не JSON-парсируется: ${bq.body.slice(0, 200)}`;
      }
    } else {
      onchainNotes =
        (!bq.hadToken ? `HTTP ${bq.status}: требуется BITQUERY_TOKEN. ` : "") +
        bq.body.slice(0, 280);
      source =
        "Bitquery недоступен → теоретическая оценка по Gamma (среднее volume24hr × число маркетов)";
    }

    console.error("Goldsky (URL из задачи)…");
    let goldskyProbe = { error: "skipped" };
    try {
      const gs = await fetch(
        "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/polymarket-orderbook-v2/prod/gn",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query:
              "{ orderFilledEvents(first: 1, orderBy: timestamp, orderDirection: desc) { id timestamp } }",
          }),
        },
      );
      const body = await gs.text();
      goldskyProbe = {
        status: gs.status,
        body_excerpt: body.slice(0, 200),
      };
    } catch (e) {
      goldskyProbe = { error: e instanceof Error ? e.message : String(e) };
    }

    const fallbackEstimateNote =
      totalTrades7dOnchain == null
        ? "Сумма volume24hr по платформе (Gamma за сутки) не есть число сделок; произведение среднего vol24 на N маркетов — грубая нижняя граница по «экспозиции», не on-chain объём за 7 дней."
        : undefined;

    if (totalTrades7dOnchain == null && totalVolume7dOnchainUsd == null) {
      totalVolume7dOnchainUsd = gammaFallbackLowerBoundTradeVolume;
      const gsErr =
        "status" in goldskyProbe && goldskyProbe.status === 404
          ? "; Goldsky: 404 subgraph not found"
          : "; Goldsky недоступен или ошибка";
      source += gsErr;
    }

    console.error("Data API…");
    const tradesProbe = await probeDataApi("/trades?limit=1");
    const activityProbe = await probeDataApi("/activity?limit=1");
    const statsProbe = await probeDataApi("/markets-stats");

    const report = {
      generatedAtUtc: new Date().toISOString(),
      gamma: {
        since7dUtcForBitquery: since7d,
        total_markets_count: totalMarketsCount,
        markets_above_1m: above1m.length,
        markets_above_100k: above100k.length,
        markets_above_10k: above10k.length,
        total_volume24h_all: round2(totalVolume24hAll),
        total_volume24h_above_1m: round2(totalVolume24Above1m),
        total_volume24h_above_100k: round2(totalVolume24Above100k),
        total_volume24h_above_10k: round2(totalVolume24Above10k),
        coverage_by_volume_pct: coverageByVolumePct,
        coverage_volume_pct_at_100k: coverage100kPct,
        coverage_volume_pct_at_10k: coverage10kPct,
        extra_markets_1m_to_100k: Math.max(above100k.length - above1m.length, 0),
        extra_markets_100k_to_10k: Math.max(above10k.length - above100k.length, 0),
        top10_by_volume24hr: top10Vol24,
        top5_candidates_100k_to_1m: top5Gap,
        top10_by_lifetime_volume: top10Lifetime,
        liquidity_gt500k_vol24_below_1m: liquidityAnomalies,
        ws_top20_equiv: {
          note: "В коде Polychotam WS берёт топ-20 активных маркетов Gamma по volume24hr (без жёсткого минимума 1M).",
          sum_volume24hr_top20: vol24Top20,
          pct_of_total_platform_volume24hr: pctTop20Ws,
        },
      },
      onchain: {
        total_trades_7d_onchain: totalTrades7dOnchain,
        total_volume_7d_onchain_usd:
          totalVolume7dOnchainUsd != null
            ? round2(totalVolume7dOnchainUsd)
            : null,
        source,
        bitquery_notes: onchainNotes || undefined,
        goldsky_probe: goldskyProbe,
      },
      theoretical_fallback:
        totalTrades7dOnchain == null && totalVolume7dOnchainUsd == null
          ? {
              avg_volume24hr_per_market: round2(avgVol24),
              product_avg_times_count_usd_equiv: gammaFallbackLowerBoundTradeVolume,
              note:
                fallbackEstimateNote ??
                "Заполнено при отсутствии данных Bitquery.",
            }
          : {
              note:
                "Gamma avg×count не нужен как proxy за on-chain объём при успешном Bitquery.",
            },
      data_api: {
        trades: tradesProbe,
        activity: activityProbe,
        markets_stats_http: statsProbe.status ?? statsProbe.error,
        aggregate_endpoints_note:
          "Публичного total trades/platform в ответах нет — только записи активности.",
      },
    };

    console.log(JSON.stringify(report, null, 2));
    return report;
  })().catch((e) => {
    console.error(String(e.message || e));
    process.exitCode = 1;
  });
}

await main();
