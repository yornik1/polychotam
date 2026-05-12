# Research: нишевые киты (volume 10K–100K) — Bitquery

**Задача в Notion:** [Research: нишевые киты (vol 10K–100K) через Bitquery](https://app.notion.com/p/3527b5e2ccce8185a07cf5a5eada7277) — в теле страницы зафиксирован **прогон 2026-04-30** (Gamma + Bitquery + сверка `wallets`).

**Прогон локально:** `node scripts/research/niche-whales-bitquery.mjs` (нужен `BITQUERY_TOKEN`; при необходимости расширьте выборку: `NICHE_WHALE_MAX_CONDITIONS=120`).

Отдельный трек от «whale predictive value»: не проверка edge по одной БД Polychotam, а **поиск адресов с высоким качеством сделок**, которые **преимущественно** торгуют в **маркетах с умеренным объёмом** (корзина **10 000–100 000 USDC** по выбранному определению объёма).

Связь с [Research: репрезентативность данных](https://www.notion.so/3517b5e2-ccce811a8c43ed40c385455d): фильтр **volume24hr > 1M** и текущие whale-алерты **не видят** таких игроков систематически.

## Вопрос исследования

- Существуют ли адреса с **аномально высоким win_rate** / **resolution PnL** (или устойчивой долей прибыльных сделок), которые **часто** торгуют в маркетах из корзины **10K–100K**?
- Насколько они **не пересекаются** с топ-китами по объёму на маркетах >1M?

## Почему Bitquery

- **Покрытие:** сделки по Polymarket на Polygon **без** ограничения «только маркеты из нашего WS».
- **Агрегации:** по `address`, по маркету/condition, по временным окнам.

Требуется **`BITQUERY_TOKEN`** (см. `scripts/research/polymarket-coverage-research.mjs`, датасет `EVM(network: matic, dataset: realtime)` и фильтр по Polymarket).

## Методология (черновик)

1. **Определить корзину «10K–100K» явно:**
   - **Вариант A:** объём торгов **за окно анализа** (7d/30d) из Bitquery **по condition/market** — консистентно для ончейна, но не равен Gamma `volume24hr` «на сейчас».
   - **Вариант B:** выгрузить из **Gamma** список `condition_id` с `volume24hr` в диапазоне 10K–100K на дату среза → на Bitquery оставить только сделки по этим маркетам (**жёсткое** совпадение с ТЗ coverage).
2. **Метрика «качества» адреса:**
   - Идеал: **resolution-based** (нужен победивший исход на маркет) — Bitquery сам по себе может не хранить финальный исход; возможен **джойн** с Gamma (`closed`, исход) или с **БД Polychotam `markets`** после backfill.
   - Упрощение: прокси без resolution (осторожно с интерпретацией).
3. **Фильтры шума:** минимальное число resolved маркетов / сделок на адрес, исключение известных MM-паттернов (отложено).
4. **Выход:** таблица адресов, доля объёма в 10K–100K vs >100K, win_rate / PnL-метрика, пересечение с текущим топ-10 whale по `getTopWalletsByVolumeOnTopMarkets`.

## Риски интерпретации

- Один игрок — **несколько адресов** (clustering).
- **Wash / фарминг объёма** в нишевых маркетах.
- Рассинхрон **Gamma volume24hr** и ончейн-объёма за период.

## Артефакты

- Сохранённые GraphQL-запросы Bitquery и пояснение к полям.
- По желанию: `scripts/research/niche-whales-bitquery.mjs` (обёртка с `.env`).

Связанные файлы: [`whale-predictive-value.md`](./whale-predictive-value.md), [`polymarket-coverage-research.mjs`](./polymarket-coverage-research.mjs).
