# Whale Predictive Value — Iteration 2 Results

## Дата прогона

2026-05-12

## Resolved universe

- До backfill: 1005 resolved маркетов (`closed = TRUE` AND `winning_token_id IS NOT NULL`)
- После backfill: 1005 (изменений нет в этой сессии)
- Метод backfill: **Вариант B — реализованы** `PolymarketHttpClient.fetchClosedMarketsGammaKeysetPage` и `MarketSyncService.backfillClosedMarketsFromGammaKeyset`; **исполнение `node dist/backfill-gamma-closed.main.js` не прогонялось**: на хосте без `REDIS_URL`/hostname `redis` — ошибки DNS, при корректном Redis конфликт Telegram polling (`409`); контейнер `app` собран без этих изменений. **Вариант C** из задачи не использовался: INSERT без обязательного `tokens` несовместим со схемой `markets`. База уже удовлетворяет порогу ≥50 resolved.

### Примечание по окну 90d vs 365d

Для сделок в подвыборке resolved + `volume24hr` фильтр: `MIN(match_time)` в universe при vol24 > 1M и >100k — **2026-04-13** (все такие сделки уже внутри 90 суток от даты прогона). Поэтому **комбинации A и C**, **B и D** дают **одинаковые** счётчики и z-score.

## Результаты

### Комбинация A: 90d + vol24 > 1M

| Метрика | Whale (≥$10k) | Non-whale |
|---------|---------------|-----------|
| N trades | 529 | 40734 |
| Hit rate PnL>0 | 0.5728 | 0.4142 |
| Avg PnL USDC | -3818.622178 | -20.456925 |
| Median PnL USDC | 38.900000 | -0.660000 |
| Sum PnL USDC | -2020051.13 | -833292.40 |

Resolved маркетов в universe: 17  
Z-score: 7.3504 | p < 0.05: да (односторонний, H1: whale HR выше)

### Комбинация B: 90d + vol24 > 100k

| Метрика | Whale (≥$10k) | Non-whale |
|---------|---------------|-----------|
| N trades | 968 | 75893 |
| Hit rate PnL>0 | 0.7025 | 0.4291 |
| Avg PnL USDC | -1985.136965 | -13.147710 |
| Median PnL USDC | 38.240000 | -0.146400 |
| Sum PnL USDC | -1921612.58 | -997819.17 |

Resolved маркетов в universe: 44  
Z-score: 17.0620 | p < 0.05: да

### Комбинация C: 365d + vol24 > 1M

Идентично комбинации A (см. примечание выше).

| Метрика | Whale (≥$10k) | Non-whale |
|---------|---------------|-----------|
| N trades | 529 | 40734 |
| Hit rate PnL>0 | 0.5728 | 0.4142 |
| Avg PnL USDC | -3818.622178 | -20.456925 |
| Median PnL USDC | 38.900000 | -0.660000 |
| Sum PnL USDC | -2020051.13 | -833292.40 |

Resolved маркетов в universe: 17  
Z-score: 7.3504 | p < 0.05: да

### Комбинация D: 365d + vol24 > 100k

Идентично комбинации B.

| Метрика | Whale (≥$10k) | Non-whale |
|---------|---------------|-----------|
| N trades | 968 | 75893 |
| Hit rate PnL>0 | 0.7025 | 0.4291 |
| Avg PnL USDC | -1985.136965 | -13.147710 |
| Median PnL USDC | 38.240000 | -0.146400 |
| Sum PnL USDC | -1921612.58 | -997819.17 |

Resolved маркетов в universe: 44  
Z-score: 17.0620 | p < 0.05: да

## Топ-20 кошельков (QUERY 3, комбинация D / B — max N; `LIMIT 20`, фактически 18 строк с `whale_trade_count >= 5`)

| # | maker_address | whale_trades | sum_pnl | hit_rate |
|---|---------------|-------------|---------|----------|
| 1 | 0x5d58e38cd0a7e6f5fa67b7f9c2f70dd70df09a15 | 10 | 723988.98 | 0.7000 |
| 2 | 0xad7f7e2f4418fe358606164eccc0d0126aa467dc | 5 | 10382.31 | 1.0000 |
| 3 | 0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1 | 9 | 7356.06 | 0.8889 |
| 4 | 0x241f846866c2de4fb67cdb0ca6b963d85e56ef50 | 207 | 7130.05 | 1.0000 |
| 5 | 0xa53c26443fb636d8ae31ac24f62fc1d5ef8f67a5 | 237 | 4636.61 | 0.8143 |
| 6 | 0xf9c1190aa8184bcbe418e6f5321c53b0bfbc39e2 | 11 | 3314.09 | 0.7273 |
| 7 | 0xbacd00c9080a82ded56f504ee8810af732b0ab35 | 5 | 1548.81 | 0.8000 |
| 8 | 0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144 | 5 | 801.24 | 1.0000 |
| 9 | 0xccc1afdec8b8a8d7770eeabc0041b610c621889d | 21 | 662.25 | 0.9524 |
| 10 | 0xc8ab97a9089a9ff7e6ef0688e6e591a066946418 | 11 | 474.76 | 0.6364 |
| 11 | 0x47ab026767cc320ac6e62f6ec747d59cf4d795df | 5 | 465.00 | 1.0000 |
| 12 | 0xc6dd722558dbfbd8fa780efcbe819ed8c6604b9f | 5 | 410.76 | 0.6000 |
| 13 | 0xa43a1b6d84230d5237df9268e98049be2f31ad85 | 5 | -68.86 | 0.4000 |
| 14 | 0xdf17f4a8dd01a4cfa6fc3da323a2baee5f8697d1 | 6 | -94.54 | 0.8333 |
| 15 | 0xdcd669c506a938bae9269a84b8bd2bdb220484cd | 8 | -483.00 | 0.1250 |
| 16 | 0x614dc8d3542c12103d2c6a3553fd761e391d1546 | 7 | -2153.73 | 0.4286 |
| 17 | 0x9495425feeb0c250accb89275c97587011b19a27 | 10 | -126728.08 | 0.0000 |
| 18 | 0xa1360dbbc43a66cfdbccd72ee8aa868d478c97de | 105 | -2453191.84 | 0.0190 |

## Smart whale cluster (те же params, что QUERY 3 для D)

- hit_rate > 0.65, trades ≥ 10: 5 кошельков
- hit_rate > 0.60, trades ≥ 5: 12 кошельков
- hit_rate > 0.55, trades ≥ 20: 3 кошелька

## Decision

**Лучшая комбинация по N:** B / D (76861 сделок в выборке, 968 whale-notional) — при текущей БД совпадает с 90d.

**Z-score (B/D):** 17.0620  
**p-value (односторонний):** < 0.05 (на порядки меньше при таких z)

**H0 (whale trades не лучше baseline по доле сделок с resolution PnL > 0):**

- [ ] Не отвергнута (edge не подтверждён)
- [x] Отвергнута (по формальному z-тесту для пропорций: whale HR выше baseline)

**Вывод (выбрать одно):**

- [x] "Edge подтверждён: whale hit rate значимо выше baseline"
- [ ] "Edge частичный: только подгруппа smart whales показывает устойчивый результат"
- [ ] "Edge не подтверждён: разница статистически не значима даже при расширенной выборке"
- [ ] "Insufficient data: resolved маркетов < 50 даже после backfill"

**Оговорка:** доля прибыльных сделок у китов выше, но **суммарный и средний resolution PnL** по когорте whale хуже, чем у non-whale из‑за экстремальных убыточных китовых лотов; median PnL у whale всё ещё положительный относительно baseline. Это не отменяет z-тест по hit rate, но меняет продуктовую интерпретацию «edge = деньги».

**Рекомендация для продукта:**

Whale alerts разумно оставить **информационным** слоем: статистика по HR не равняется гарантированной прибыльности подписчика из‑за тяжёлых хвостов и отсутствия учёта исполнения. Если расширять продукт — имеет смысл **smart scoring** по кошельку (QUERY 3 / subcluster), а не усиление сигнала только по размеру нотионала.

## Ограничения

- volume24hr — снимок на момент синка, не на дату сделки
- win_rate не учитывает sizing (маленькие winning + большие losing = positive HR, negative PnL)
- Нет учёта кластеризации адресов (один игрок — несколько кошельков)
- Resolution PnL не учитывает cost of capital / time value
