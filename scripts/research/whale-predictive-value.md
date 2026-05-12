# Whale predictive value — артефакты для execution

Связанные страницы Notion: ТЗ «Research: predictive value whale trades», задача «Research execution: whale predictive value (числа и выводы)».

## 1. Сверка с Research (coverage)

**Выводы из зависимого Research (репрезентативность, Done):**

- Порог `volume24hr > 1M` покрывает лишь ~половину Σ volume24 платформы; «нишевые» киты в тихих маркетах систематически не видны.
- Для аналитики рекомендован **порог `volume24hr ≥ 100 000`** (и сверка `COUNT(DB)` ↔ Bitquery за 7 дней).
- Поток WS/топ-маркеты не заменяют проверку **predictive value** — это отдельный трек.

**Как это стыкуется с кодом Polychotam:**

| Место | Порог volume24hr | Комментарий |
|--------|-------------------|-------------|
| [`src/markets/markets.service.ts`](../../src/markets/markets.service.ts) (`getTopMarkets`) | **100 000** | Совпадает с рекомендацией coverage для «шире топов». |
| [`src/wallets/wallets.service.ts`](../../src/wallets/wallets.service.ts) (`getTopWalletsByVolumeOnTopMarkets`) | **1 000 000** | Используется для **Telegram** `/top` и **whale alerts** — уже **уже**, чем рекомендация coverage и для API топ-маркетов. Минимальный объём сделки **$10 000** USDC. |

**Импликация для исследования:** при бэктестах и отчёте явно фиксировать, какой фильтр маркета используется (1M как в прод-алертах vs 100k как в coverage). Иначе выводы по «китам» несопоставимы с фактическим поведением бота или наоборот — занижают нишевой edge.

## 2. Mark-to-market и BBO (дизайн, без реализации)

**Зачем:** в ТЗ разделены **MtM** (краткие горизонты) и **resolution PnL**. MtM по последней сделке на Polymarket завышает/искажает результат из‑за широких спредов.

**Минимально достаточный сбор:**

- Снимки **BBO** (best bid, best offer) по `asset_id` / token_id с меткой времени, синхронно с потоком сделок или с фиксированным шагом (например 1–5 с для research, реже для прода).
- Маркировочная цена: `mid = (best_bid + best_offer) / 2` при обоих уровнях; если стакан пуст с одной стороны — политика в explicit (last mid, skip bar, forward-fill).

**Источник:** WebSocket order book канал Polymarket CLOB (по текущей архитектуре проекта — отдельная подписка/воркер, не только `last_trade`).

**Хранение (целевая схема, offline/аналитика):** отдельная таблица вроде `orderbook_bbo_snapshots(asset_id, ts, best_bid, best_ask, source)` с индексом `(asset_id, ts)`. Для MVP-исследования допустим экспорт в Parquet/CSV из одноразового коллектора.

**Блокер:** в текущей схеме [`Trade`](../../src/trades/trade.entity.ts) и [`Market`](../../src/markets/market.entity.ts) **нет** истории стакана — MtM по ТЗ **нельзя** честно считать только из `trades.price`.

## 3. Gating продукта (до расширения backend / Telegram)

Пока в Notion-задаче execution нет зафиксированного **Decision**, не расширять продуктовую логику:

- нет новых **smart scores**, порогов алертов и пайплайнов WS → scoring → канал;
- текущие эвристики (`getTopWalletsByVolumeOnTopMarkets`, кэш в [`trade-alert.service.ts`](../../src/telegram/trade-alert.service.ts)) считаются **информационным** слоем, не подтверждающим edge.

**Критерии Decision (заполнить по результатам execution):**

1. **H1 подтверждена или нет** на resolution-PnL и/или MtM относительно baselines из ТЗ.
2. Есть ли **устойчивые подгруппы** (размер, vol24, время до resolution, тип кошелька).
3. Оценка **false positives** для whale alerts при сценариях задержки и slippage (как в ТЗ).

После явного выбора ветки («edge есть / только ниша / нет») — отдельные продуктовые задачи (Smart Alerts vs informational feed).

## 4. Эмпирический прогон (что делаете вы локально)

**БД (resolution PnL, baselines):** из корня репозитория, с поднятым `docker compose`:

```bash
docker compose exec -T postgres psql -U postgres -d polychotam -v ON_ERROR_STOP=1 \
  -f scripts/research/whale-resolution-backtest.sql
```

В файле три последовательных запроса: диагностика выборки, сравнение **whale vs non-whale** hit rate / median PnL в одной и той же resolved-вселенной, топ кошельков по суммарному PnL среди сделок выше `min_trade_usd`. Пороги правятся в CTE `params` в начале каждого блока (скопируйте блок и смените `min_vol24` на `100000` для согласования с [`getTopMarkets`](../../src/markets/markets.service.ts)).

**Охват / Gamma / Bitquery:** без доступа к вашей БД уже можно снять срез платформы:

```bash
node scripts/research/polymarket-coverage-research.mjs
```

Для строки `totalTrades7dOnchain` в выводе нужен **`BITQUERY_TOKEN`** в `.env` или `.env.local` (см. заголовок скрипта). Без токена Gamma-часть всё равно отрабатывает.

**Свежий срез Gamma (пример прогона `2026-04-29T19:20Z`, без гарантии повторяемости):** ~50k активных маркетов; доля Σ `volume24hr` при порогах ≥1M / ≥100k / ≥10k — около **52% / 78% / 94%**; маркетов с `volume24hr` ≥1M — **18** шт. Точные цифры смотрите в JSON последнего запуска у себя.

**Decision (edge есть / нет / частичный):** заполняется в Notion на задаче execution после того, как зафиксированы результаты QUERY 2 (когорты) и при необходимости повтор с `min_vol24 = 100000`, плюс при наличии токена — отношение `COUNT(trades в БД за 7д) / Bitquery count`.

## 5. Итерация 1 (completed, 2026-04-29)

Синхронизировано с Notion: [Research execution](https://app.notion.com/p/3517b5e2ccce8166a8e7f3fef3c72331).

**Прогон SQL (90d, whale notional ≥ $10k):** resolved маркетов **4–5** (vol24 1M или 100k); китовых сделок **34–37**. Hit rate PnL>0: whale **0,559** vs baseline **0,505** — при N≈34 разница **не значима** (p>0.05). Median resolution PnL: ~**45** USDC vs ~**0,003** USDC у non-whale — учитывать разный масштаб notional (часть эффекта может быть sizing, а не directional alpha).

**Предварительные выводы:** больше USDC на сделку у крупных лотов при сопоставимом hit rate; устойчивый directional edge не подтверждён; внутри когорты китов возможно расслоение (см. QUERY 3).

**Blockers H0/H1:** мало resolved маркетов за 90d; нужен backfill закрытых маркетов с исходом и/или окно 6–12 мес.

## 6. Бэкфилл закрытых маркетов (Gamma keyset) — Iteration 2+

Реализовано в приложении:

- HTTP: [`PolymarketHttpClient.fetchClosedMarketsGammaKeysetPage`](../../src/polymarket/polymarket-http.client.ts) — страница `/markets/keyset?closed=true`.
- Сервис: [`MarketSyncService.backfillClosedMarketsFromGammaKeyset`](../../src/markets/market-sync.service.ts) — upsert через существующий `upsertGammaMarketsAndCollectNewlyResolved` ( **`winning_token_id`** задаётся только если Gamma отдаёт согласованные `clobTokenIds` / `outcomePrices`).

Запуск (нужны **PostgreSQL** и **REDIS** как у обычного `AppModule`):

```bash
npm run backfill:gamma-closed
```

Опционально: `BACKFILL_GAMMA_CLOSED_MAX_PAGES` (по умолчанию 2000), `BACKFILL_GAMMA_CLOSED_PAGE_SIZE` (по умолчанию 500, макс. 1000). Джобы пересчёта кошельков скрипт **не ставит**; при необходимости обработайте `newlyResolvedConditionIds` из лога через `PolymarketMarketResolutionService.enqueueWalletRecalcForMarketTraders`.

После бэкфила повторите [`whale-resolution-backtest.sql`](./whale-resolution-backtest.sql).

**MtM + BBO** и **wallet clustering** (ко-трейдинг / мульти-адреса) — по-прежнему отдельные задачи; clustering без внешних графов пока только эвристики вручную.
