#!/usr/bin/env node
/**
 * Нишевые «киты»: объём в Bitquery за ~7d по **выборке** маркетов Gamma (vol24 ∈ [10K,100K)),
 * приоритет — маркеты с большим vol24 в корзине (не вся корзина: см. NICHE_WHALE_MAX_CONDITIONS).
 * Опционально win_rate из `wallets` (docker compose postgres).
 *
 * Запуск: node scripts/research/niche-whales-bitquery.mjs
 * Env: BITQUERY_TOKEN
 *      NICHE_WHALE_MAX_CONDITIONS (по умолчанию 200) — сколько верхних condition_id по vol24 брать из корзины
 *      NICHE_WHALE_CONDITION_BATCH_SIZE — макс. condition_id в одном запросе (по умолчанию: все в один батч)
 *      NICHE_WHALE_BITQUERY_TOP_LIMIT — лимит групп Buyer/Seller на запрос (по умолчанию 200)
 *
 * При нескольких батчах объёмы по одному адресу **суммируются** между батчами; итоговый топ — после этой суммы.
 * Усечение: в каждом запросе Bitquery всё равно не более TOP_LIMIT адресов на сторону — см. bitquery.disclaimer.
 */
/* eslint-disable no-console */

import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
  quiet: true,
});
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
  override: true,
  quiet: true,
});

const GAMMA_KEYSET = "https://gamma-api.polymarket.com/markets/keyset";

const FETCH_TIMEOUT_MS = 60_000;
const BITQUERY_TIMEOUT_MS = Math.max(
  90_000,
  Number.parseInt(process.env.BITQUERY_TIMEOUT_MS ?? "120000", 10) || 120_000,
);

function parseEnvPositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return n;
}

/** Разбиение массива на чанки фиксированного размера (последний может быть короче). */
function chunkBySize(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const size = Math.max(1, chunkSize);
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

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
  const cid =
    typeof m.conditionId === "string"
      ? m.conditionId.trim()
      : typeof m.condition_id === "string"
        ? m.condition_id.trim()
        : "";
  const question = typeof m.question === "string" ? m.question : "";
  return { conditionId: cid, question, volume24hr };
}

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

async function fetchAllActiveMarketsKeyset() {
  const limitFallbacks = [1000, 500, 250, 100];
  let cursor;
  const all = [];
  let page = 0;
  for (;;) {
    let payload = null;
    let usedLimit = 1000;
    let lastErr = "";
    const paramsBase = new URLSearchParams({
      active: "true",
      closed: "false",
      limit: String(usedLimit),
    });
    for (const lim of limitFallbacks) {
      try {
        const params = new URLSearchParams({
          active: "true",
          closed: "false",
          limit: String(lim),
        });
        if (cursor) {
          params.set("after_cursor", cursor);
        }
        const res = await fetchWithRetry(`${GAMMA_KEYSET}?${params}`);
        payload = await res.json();
        usedLimit = lim;
        lastErr = "";
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        console.error(`Gamma keyset: ${lastErr.slice(0, 120)}`);
      }
    }
    if (!payload || !Array.isArray(payload.markets)) {
      throw new Error(`Gamma keyset: нет markets: ${lastErr}`);
    }
    page += 1;
    console.error(`Gamma: страница ${page}, маркетов ${payload.markets.length}`);
    for (const m of payload.markets) {
      all.push(normMarket(m));
    }
    const nextCursor = payload.next_cursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) {
      break;
    }
    if (payload.markets.length < usedLimit) {
      break;
    }
    cursor = nextCursor;
  }
  return all;
}

function sinceDaysIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

async function bitqueryTopSide(
  token,
  sinceIso,
  conditionIds,
  side,
  topLimit,
) {
  /** side: 'Buyer' | 'Seller' — отдельные limitBy в API */
  const limitCount = Math.max(1, Math.min(500, topLimit));
  const field =
    side === "Buyer"
      ? "Trade_OutcomeTrade_Buyer"
      : "Trade_OutcomeTrade_Seller";
  const query = `query {
    EVM(network: matic, dataset: realtime) {
      PredictionTrades(
        where: {
          TransactionStatus: { Success: true }
          Block: { Time: { since: "${sinceIso}" } }
          Trade: {
            Prediction: {
              Marketplace: { ProtocolName: { is: "polymarket" } }
              ConditionId: { in: [${conditionIds.map((id) => `\"${id}\"`).join(", ")}] }
            }
          }
        }
        limit: { count: ${limitCount} }
        orderBy: { descendingByField: "volume_usd" }
        limitBy: { by: ${field} }
      ) {
        volume_usd: sum(of: Trade_OutcomeTrade_CollateralAmountInUSD)
        Trade {
          OutcomeTrade {
            Buyer
            Seller
          }
        }
      }
    }
  }`;

  const ac =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(BITQUERY_TIMEOUT_MS)
      : undefined;
  const res = await fetch("https://streaming.bitquery.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
    signal: ac,
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: res.ok, status: res.status, error: "json", body: text.slice(0, 400) };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
  if (Array.isArray(j.errors) && j.errors.length > 0) {
    return { ok: false, errors: j.errors };
  }
  const evm = j?.data?.EVM;
  const row = Array.isArray(evm) ? evm[0] : evm;
  const rows = row?.PredictionTrades;
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const out = [];
  for (const r of list) {
    const addr =
      side === "Buyer"
        ? r?.Trade?.OutcomeTrade?.Buyer
        : r?.Trade?.OutcomeTrade?.Seller;
    const vol = Number(r?.volume_usd);
    if (typeof addr === "string" && addr.startsWith("0x") && Number.isFinite(vol)) {
      out.push({ address: addr.toLowerCase(), volumeUsd: vol, side });
    }
  }
  return { ok: true, rows: out };
}

/**
 * Батчи по condition_id: для каждого батча — Buyer + Seller; строки всех батчей конкатенируются
 * (дальше mergeVolumes суммирует по адресу).
 */
async function runBitqueryBatched(
  token,
  sinceIso,
  conditionIds,
  batchSize,
  topLimitPerSide,
) {
  const batches =
    batchSize >= conditionIds.length
      ? [conditionIds]
      : chunkBySize(conditionIds, batchSize);
  const buyerAll = [];
  const sellerAll = [];
  /** @type {unknown[]} */
  const errors = [];
  let batchIndex = 0;
  for (const batch of batches) {
    batchIndex += 1;
    const [b, s] = await Promise.all([
      bitqueryTopSide(token, sinceIso, batch, "Buyer", topLimitPerSide),
      bitqueryTopSide(token, sinceIso, batch, "Seller", topLimitPerSide),
    ]);
    if (!b.ok) {
      errors.push({ batchIndex, buyerQuery: b, conditionIdsInBatch: batch.length });
    } else {
      buyerAll.push(...b.rows);
    }
    if (!s.ok) {
      errors.push({ batchIndex, sellerQuery: s, conditionIdsInBatch: batch.length });
    } else {
      sellerAll.push(...s.rows);
    }
    if (batchIndex < batches.length) {
      await new Promise((r) =>
        setTimeout(r, Number.parseInt(process.env.NICHE_WHALE_BATCH_PAUSE_MS ?? "400", 10) || 400),
      );
    }
  }
  return {
    buyerAll,
    sellerAll,
    batching: {
      batchesTotal: batches.length,
      batchSizeConfigured: batchSize,
      conditionsTotal: conditionIds.length,
      topLimitPerSide,
    },
    errors,
  };
}

function mergeVolumes(buyers, sellers) {
  const map = new Map();
  for (const r of [...buyers, ...sellers]) {
    const v = map.get(r.address) ?? 0;
    map.set(r.address, v + r.volumeUsd);
  }
  return [...map.entries()]
    .map(([address, volumeUsd]) => ({ address, volumeUsd }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
}

function tryDbWinRates(addresses, projectRoot) {
  if (addresses.length === 0) {
    return new Map();
  }
  try {
    const inList = addresses
      .map((a) => `'${String(a).toLowerCase().replace(/'/g, "''")}'`)
      .join(", ");
    const sql = `SELECT lower(trim(address)) AS a, win_rate::text, trade_count::text FROM wallets WHERE lower(trim(address)) IN (${inList});\n`;
    const out = execSync(
      `docker compose exec -T postgres psql -U postgres -d polychotam -t -A -F'|'`,
      {
        cwd: projectRoot,
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const m = new Map();
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (!t) {
        continue;
      }
      const [addr, winRate, tradeCount] = t.split("|");
      if (addr) {
        m.set(addr.toLowerCase(), {
          winRate: winRate ?? null,
          tradeCount: tradeCount ?? null,
        });
      }
    }
    return m;
  } catch {
    console.error(
      "DB: пропуск (docker compose / wallets недоступны); только Bitquery.",
    );
    return new Map();
  }
}

/** Максимум condition в выборке: по умолчанию 200; `all` — вся корзина. */
function parseMaxConditions(raw, total) {
  const fallback = Math.min(200, total);
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const s = String(raw).trim().toLowerCase();
  if (s === "all") {
    return total;
  }
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, total);
}

/** Размер батча Bitquery по condition_id; пустое — один запрос на всю выборку. */
function parseBatchSize(raw, sampleLen) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return sampleLen;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    return sampleLen;
  }
  return n;
}

/** Ненулевой trade_count из поля строки/psql вывода. */
function walletTradeCountIsPositive(tc) {
  if (tc === null || tc === undefined || tc === "") {
    return false;
  }
  const n = Number(typeof tc === "string" ? tc : String(tc));
  return Number.isFinite(n) && n > 0;
}

async function main() {
  const token = process.env.BITQUERY_TOKEN?.trim();
  const sinceIso = sinceDaysIso(7);
  const topLimitPerSide = Math.min(
    500,
    Math.max(1, parseEnvPositiveInt(process.env.NICHE_WHALE_BITQUERY_TOP_LIMIT, 200)),
  );
  const topOutputLimit = Math.max(
    10,
    parseEnvPositiveInt(process.env.NICHE_WHALE_TOP_OUTPUT_LIMIT, 80),
  );
  const dbCrosscheckTopN = Math.min(
    topOutputLimit,
    Math.max(
      1,
      Number.parseInt(process.env.NICHE_WHALE_DB_TOP_N ?? "25", 10) || 25,
    ),
  );

  console.error("Gamma: загрузка активных маркетов…");
  const markets = await fetchAllActiveMarketsKeyset();
  const niche = markets.filter(
    (m) =>
      m.conditionId.length > 0 &&
      m.volume24hr >= 10_000 &&
      m.volume24hr < 100_000,
  );
  const volByCid = new Map();
  for (const m of niche) {
    volByCid.set(m.conditionId, Math.max(volByCid.get(m.conditionId) ?? 0, m.volume24hr));
  }
  const uniqueCids = [...new Set(niche.map((m) => m.conditionId))].sort(
    (a, b) => (volByCid.get(b) ?? 0) - (volByCid.get(a) ?? 0),
  );
  const maxCond = parseMaxConditions(
    process.env.NICHE_WHALE_MAX_CONDITIONS,
    uniqueCids.length,
  );
  const sampleIds = uniqueCids.slice(0, maxCond);
  const conditionBatchSize = parseBatchSize(
    process.env.NICHE_WHALE_CONDITION_BATCH_SIZE,
    sampleIds.length,
  );

  const result = {
    generatedAtUtc: new Date().toISOString(),
    gamma: {
      activeMarketsTotal: markets.length,
      nicheBucketVol24Min10kMax100k: {
        marketsRows: niche.length,
        uniqueConditions: uniqueCids.length,
      },
      analysisSample: {
        topConditionsByVol24InBucket: sampleIds.length,
        conditionIds: sampleIds.slice(0, 15),
        note: "Полный список sampleIds в JSON (поле analysisSample.conditionIdsFull) для воспроизводимости.",
        conditionIdsFull: sampleIds,
      },
    },
    bitquery: {
      sinceIso,
      network: "matic",
      dataset: "realtime",
      note: "Топ Buyer/Seller по сумме CollateralAmountInUSD за окно sinceIso внутри выборки маркетов; при NICHE_WHALE_MAX_CONDITIONS < uniqueConditions — не вся корзина.",
      disclaimer: [
        "Датасет realtime Bitquery ≈ последние ~7 дней; окно запроса совпадает с sinceIso.",
        "Поле wallet win_rate в БД — не полный on-chain win rate.",
        "Пары адресов с близким/одинаковым объёмом могут соответствовать buyer/seller одной серии сделок.",
        `На каждый HTTP-запрос Bitquery возвращает не более topLimitPerSide (${topLimitPerSide}) адресов на сторону (Buyer и Seller отдельно); при батчах по маркетам объёмы по одному адресу суммируются между батчами, но адреса ниже порога в каком-либо батче в ответ не попадают — итоговый ранг не глобально полон без увеличения лимита или другого запроса.`,
      ],
    },
    summary: {
      nicheConditionsInSample: sampleIds.length,
      top10AddressesByVolumeUsd: [],
      dbWalletsWithNonZeroTradeCountAmongTopN: {
        n: dbCrosscheckTopN,
        count: 0,
      },
    },
    topAddressesByVolumeUsdInNicheMarkets: [],
    dbWalletWinRateForTop: [],
    errors: [],
  };

  if (!token) {
    result.errors.push("Нет BITQUERY_TOKEN — Bitquery не вызывался.");
    const text = JSON.stringify(result, null, 2);
    console.log(text);
    process.exit(0);
  }

  if (sampleIds.length === 0) {
    result.errors.push("Пустая выборка condition_id.");
    const text = JSON.stringify(result, null, 2);
    console.log(text);
    process.exit(0);
  }

  const bq = await runBitqueryBatched(
    token,
    sinceIso,
    sampleIds,
    conditionBatchSize,
    topLimitPerSide,
  );
  const pauseBetween =
    Number.parseInt(process.env.NICHE_WHALE_BATCH_PAUSE_MS ?? "400", 10) || 400;
  result.bitquery.batching = {
    conditionBatchSizeRequested: conditionBatchSize,
    topLimitPerSide,
    batchesTotal: bq.batching.batchesTotal,
    conditionIdsTotalInSample: sampleIds.length,
    pauseMsBetweenBatches: pauseBetween,
    bitqueryBatchErrors: bq.errors.length,
  };
  if (bq.errors.length > 0) {
    result.errors.push(...bq.errors);
  }

  const merged = mergeVolumes(bq.buyerAll, bq.sellerAll);
  result.topAddressesByVolumeUsdInNicheMarkets = merged.slice(0, topOutputLimit);
  result.summary.top10AddressesByVolumeUsd = merged.slice(0, 10).map((x) => ({
    address: x.address,
    volumeUsd: round2(x.volumeUsd),
  }));

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const topAddrs = result.topAddressesByVolumeUsdInNicheMarkets
    .slice(0, dbCrosscheckTopN)
    .map((x) => x.address);
  const winMap = tryDbWinRates(topAddrs, projectRoot);
  for (const row of result.topAddressesByVolumeUsdInNicheMarkets.slice(
    0,
    dbCrosscheckTopN,
  )) {
    const w = winMap.get(row.address);
    result.dbWalletWinRateForTop.push({
      address: row.address,
      volumeUsdNicheMarketsBitquery7d: round2(row.volumeUsd),
      wallet_win_rate: w?.winRate ?? null,
      wallet_trade_count: w?.tradeCount ?? null,
    });
  }
  let nz = 0;
  for (const row of result.dbWalletWinRateForTop) {
    if (walletTradeCountIsPositive(row.wallet_trade_count)) {
      nz += 1;
    }
  }
  result.summary.dbWalletsWithNonZeroTradeCountAmongTopN.count = nz;

  const text = JSON.stringify(result, null, 2);
  const jsonOut = process.env.NICHE_WHALE_JSON_OUT?.trim();
  if (jsonOut) {
    const abs = resolve(projectRoot, jsonOut);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
    console.error(`JSON также записан: ${abs}`);
  }
  console.log(text);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
