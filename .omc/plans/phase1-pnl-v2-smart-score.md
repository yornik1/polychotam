# Polychotam 2.0 — Фаза 1 «Фундамент доверия» (PnL v2 + Smart Score)

Статус: **APPROVED** (ralplan-консенсус 2026-06-10: Planner v2 → Architect APPROVE → Critic ACCEPT-WITH-RESERVATIONS, условия C1–C5 внесены в текст задач ниже).
Источник требований: Notion «Polychotam 2.0» (https://app.notion.com/p/37a7b5e2ccce815fb7f7f1c315f51f1c), Фаза 1.
Исполнение: sonnet (реализация), haiku (мелкая верификация), opus (гейты T6/T8/T13 — ревью PnL-методологии и весов скоринга).
Подход: TDD (spec первым), Vitest, минимальные изменения, контракты в `src/types/contracts.ts`, комментарии на русском, conventional commits.

## Принципы

1. **Источник истины — кошелёк, не локальная выборка.** PnL и скилл считаются от полной on-chain истории (data-api `/activity` + `/positions`), не от `maker_address`-подмножества в нашей БД. Локальный resolved-only PnL остаётся внутренним fallback, из пользовательского вывода исчезает.
2. **Каждое число проверяемо, спорное не публикуется.** Методология валидируется против `lb-api/profit` окно-к-окну на `all` и `30d`: `|pnl_v2 − lb| ≤ max(ε_abs, ε_rel·|lb|)`. Расхождение > ε → кошелёк `validated=false`, исключён из `/top`, admin-алерт. Окно 90d (в lb-api отсутствует) наследует доверие от валидации методологии на all/30d.
3. **Бот — продукт, не админка.** Операционка за `ADMIN_CHAT_ID`, ноль disclaimers.
4. **Дёшево по сети, устойчиво к китам.** Инкрементальный синк по timestamp-watermark; rate limit встроен (лимитер очереди 8/s + межстраничный delay).
5. **Минимальные изменения и TDD.**

## Факты внешних API (живые спайки 2026-06-10, ground truth)

- `GET data-api.polymarket.com/activity?user=<addr>` — плоский JSON-массив, **курсора нет**. Пагинация `offset`+`limit` (max 500). Параметры: `start`/`end` (unix ts, **оба инклюзивны** — проверено на границе), `sortDirection=ASC`, `type=` фильтр.
- Поля записи: `proxyWallet, timestamp, conditionId, type, size, usdcSize, transactionHash, price, asset, side, outcomeIndex, title, slug, eventSlug, outcome, name, pseudonym, ...`
- Встреченные типы: `TRADE` (side BUY/SELL), `REDEEM` (бывает `usdcSize=0` — валидно), `REWARD`, **`MAKER_REBATE`** (именно так, не «REBATE»). `SPLIT`/`MERGE`/`CONVERSION` в выборке не встретились — обработка по гипотезе (см. T2).
- `GET data-api.polymarket.com/positions?user=<addr>` — поля `size, avgPrice, curPrice, currentValue, cashPnl, realizedPnl, redeemable, negativeRisk, ...`. Параметр `sizeThreshold=0` передавать (безвреден), но эмпирически MTM от него не менялся — он НЕ причина остаточных расхождений.
- `GET lb-api.polymarket.com/profit?window=&address=` — окна **только** `1d|7d|30d|all` (90d НЕТ). Ответ `[{proxyWallet, amount, ...}]`. **lb-api включает mark-to-market открытых позиций** (эмпирически: 0x2fb9a206, 299 операций: realized-only −199.40, realized+MTM −8.34 vs lb −7.66).
- Эмпирические расхождения формулы (6 кошельков с полной историей): −0.10, +0.22, −3.16, −3.21, −28.67, −37.57. Расхождения $3–37 **не объяснены** (known-unknown; гипотеза — negRisk `CONVERSION`). Такие кошельки честно получают `validated=false`.
- Дедуп: глобальный дедуп по ключу **некорректен** — 4-ключ съедает 5 легитимных операций (0x8de377c6), даже 6-ключ коллизирует на легитимных идентичных операциях (0xedf4e982). Дедуп — только на граничном timestamp (см. T4).
- Существующий кит-кейс: активный трейдер = сотни операций одной страницей; крупные киты — тысячи (несколько страниц). Несжимаемая история качается один раз, дальше инкрементально.

## Задачи (зависимости в скобках; TDD: spec первым)

### T0. Контракты в `src/types/contracts.ts` · sonnet
Добавить: `WalletPnlV2Summary` (method, realizedPnl, openPositionsValue, totalPnl, byOperation, computedAt, validated), `WalletActivityRaw` (поля по фактам выше), `WalletPositionRaw` (+ `currentValue`), `WalletScore` (pnl90d, winRate, profitFactor, specialization {politics,sports,crypto,other}, sampleSize), `WalletPnlRecalcJob`, `SmartScoreRecalcJob`, `LbProfitResult` (`{proxyWallet, amount}`), `WalletPnlDivergence`.
**Расширить union `WalletPnlMethod` (contracts.ts:32) литералом `"cash_flow_wallet_activity"`** (существующий `resolved_only_local_trades` оставить). Не дублировать типы.
Acceptance: `npm run typecheck` зелёный; старые типы не тронуты.

### T1. Data-API клиент: `/activity` + `/positions` + lb-api `/profit` (T0) · sonnet
Файлы: `src/polymarket/data-api.client.ts` (+ `.spec.ts`). Паттерн ошибок/timeout — из `polymarket-http.client.ts`; env `POLYMARKET_DATA_API_URL` уже используется в `backfill.service.ts`; offset-пагинация — как там же (`:166-214`); URL lb-api — новый env `POLYMARKET_LB_API_URL` (через ConfigService, дефолт `https://lb-api.polymarket.com`).
- `fetchActivity(addr, {start?, end?, type?, offset, limit:500, sortDirection:"ASC"})` — резюмируемая offset-пагинация, терминирование по пустой/неполной странице.
- `fetchPositions(addr, {sizeThreshold:0})` — offset-пагинация.
- `fetchLbProfit(addr, window)` — window валидируется: только `"1d"|"7d"|"30d"|"all"` (тип-литерал), 90d невозможен на уровне типов.
- НЕ использовать `cashPnl`/`makerPnl` как источник истины. Сетевые/парсинговые ошибки — throw (не проглатывать).
Тесты: пагинация (полная/пустая/последняя страница), инклюзивность start/end, sizeThreshold, валидация окна lb, 4xx/5xx/timeout.

### T2. Чистая формула `computeCashFlowPnl` (T0) · sonnet — **opus-гейт на ревью формулы вместе с T6**
Файл: `src/wallets/wallet-pnl-v2.util.ts` (+ `.spec.ts`). Чистая функция, без сети/БД.
**Формула (условие C1 Critic):**
```
realizedCashFlow = Σ usdcSize(TRADE:SELL, REDEEM, MERGE, REWARD, MAKER_REBATE)
                 − Σ usdcSize(TRADE:BUY, SPLIT)
totalPnl = realizedCashFlow + Σ positions.currentValue   // MTM, sizeThreshold=0
```
- Использовать **`usdcSize`** (фактический долларовый поток), НЕ `size×price`.
- `usdcSize=0` — валидная запись (не skip): кейс REDEEM с usdcSize=0.
- Неизвестный `type` → учёт в `dataGaps` + warn, не падение.
- **Условие Critic (What's-Missing): `SPLIT`/`MERGE`/`CONVERSION` обработаны по гипотезе, эмпирически не подтверждены** — суммировать (SPLIT→отток, MERGE→приток, CONVERSION→dataGaps+warn как unknown), но при встрече ЛЮБОГО из них помечать результат warn-флагом (`hypothesisTypes: string[]` в результате) — чтобы кошелёк с ними был виден в кросс-валидации отдельно.
Тесты: каждый тип; MTM; REDEEM/usdcSize=0; запись usdcSize=0; неизвестный type; SPLIT/MERGE → warn-флаг; пустые входы.

### T3. Миграция `wallet_pnl_snapshots` + entity (T0) · sonnet
Файлы: `src/wallets/wallet-pnl-snapshot.entity.ts`, `src/migrations/<ts>-AddWalletPnlSnapshots.ts`, регистрация в `WalletsModule`.
PK `(address, window)`; колонки: `pnl`, `realized_pnl`, `open_positions_value`, `by_operation` (jsonb), `last_watermark_ts` (bigint, unix), `boundary_ids` (jsonb — identity граничных записей для дедупа T4), `validated` (boolean, default false), `computed_at`, `internal_created_at`, `internal_updated_at`.
Только `npm run migration:generate` → выверить → `migration:run`. Миграция обратима.

### T4. `WalletPnlV2Service`: снапшоты + инкрементальный синк + TTL (T1,T2,T3) · sonnet
Файл: `src/wallets/wallet-pnl-v2.service.ts` (+ int-spec).
- `getOrComputePnl(addr, window)`: снапшот свеж (TTL из ConfigService) → отдать; иначе синк.
- Инкрементальный синк: `start = last_watermark_ts` (инклюзивно), `sortDirection=ASC`, offset внутри окна.
- **Дедуп (условие C2 Critic, ПЕРЕОПРЕДЕЛЯЕТ M3/Architect-6-ключ): только на граничном timestamp.** Внутри окна записи НЕ дедупить (идентичные операции легитимны). Хранить identity записей с `ts == watermark` (из `boundary_ids` снапшота), при следующем проходе отбрасывать только их точные повторы.
- Watermark = `max(ts)` обработанных; **коммит снапшота + watermark + boundary_ids атомарно в транзакции, только при полном успехе окна**. При прерывании окно пересчитывается заново от `last_watermark_ts` (промежуточный offset нигде не персистится — это безопасно при детерминированном пересчёте).
- Ошибка синка/частичной страницы → throw (попадёт в `@OnWorkerEvent("failed")` → NDJSON). Никаких try/catch-проглатываний.
Тесты (int): снапшот пишется; повторный синк не дублирует; **два окна с перекрытием по граничному ts (несколько записей с одинаковым ts) не двоят и не теряют**; **легитимные идентичные операции внутри окна НЕ съедаются**; TTL; кит-кейс (несколько страниц) резюмируется.

### T5. BullMQ-джоб `wallet-pnl-recalc` + cron (T4) · sonnet
Файлы: `src/queue/trades-queue.config.ts`, `src/queue/wallet-analytics.processor.ts`, новый `src/wallets/wallet-pnl-cron.service.ts` (паттерн `GammaMarketCronService`).
- Новый job-name `WALLET_ANALYTICS_JOB_PNL_RECALC` в очереди `wallet-analytics`.
- **Существующий guard `if (job.name !== ...) return` (processor.ts:35-40) НЕ трогать** — добавить ветку маршрутизации по `job.name`.
- Пересчёт детерминированно от watermark в транзакции (не аппенд) — ретрай `attempts:3` не двоит.
- on-demand jobId = адрес (коалесцирование, как `enqueueWalletRecalcForMarketTraders`).
- **cron-jobId БЕЗ двоеточия (условие C3 Critic): переиспользовать `tradesDerivedJobId` (trades-queue.config.ts:19) → `wallet-pnl-cron-<date-hour>`.** BullMQ запрещает `:` в jobId — с двоеточием cron умрёт на первом тике.
- Cron ставит джобы для пула кошельков (smart whitelist + кандидаты) с учётом лимитера 8/s.
Тесты: маршрутизация; идемпотентность при ретрае (снапшот не двоится); jobId без `:`; NDJSON при падении.

### T6. Кросс-валидация с lb-api + ε + admin-алерт (T1,T4) · sonnet, **opus-гейт: ревью методологии перед мержем**
Файлы: `src/wallets/lb-cross-check.util.ts` (+ `.spec.ts`), `src/wallets/lb-cross-check.service.ts` (+ int-spec).
- Сходимость окно-к-окну на `all` и `30d`: `|pnl_v2(w) − lb(w)| ≤ max(ε_abs, ε_rel·|lb|)`.
- **Условие M-resid Critic: ε из ConfigService, стартовая калибровка `ε_abs=$1`, `ε_rel=1%` — помечены «калибровочные, уточняются по живым кошелькам, НЕ подгонять под зелёный тест».** Второй порог `WALLET_PNL_INVESTIGATION_THRESHOLD` (старт $50 или 2%) → отдельный admin-алерт «нужно доисследование CONVERSION/negRisk».
- Расхождение > ε → `validated=false` в снапшоте, исключение из `/top`, admin-алерт (адрес + оба числа + окно).
- Эмпирические фикстуры: 0x2fb9a206 (−8.34 vs −7.66 → pass), 0x48e6bed9 (REWARD, diff −0.10 → pass), кошельки с diff $3–37 → честный `validated=false` (это корректное поведение, НЕ расширять ε ради них).
Тесты: ε-логика (pass/fail/investigation); int на 5+ кошельков-фикстур на окнах all+30d; алерт-пути.

### T7. `markets.category` + backfill из Gamma (T0) · sonnet
Файлы: `src/migrations/<ts>-AddMarketCategory.ts`, `src/markets/market.entity.ts` (nullable `category`), `src/markets/market.mapper.ts`, `src/polymarket/dto/gamma-market.raw.ts`, дозаполнение в существующем Gamma-синке.
Чистая `mapGammaCategory(raw) => "politics"|"sports"|"crypto"|"other"` (из category/tags/series/slug-эвристики) + юнит-тесты. Backfill существующих строк. Nullable не ломает старые строки.

### T8. `wallet_scores` + `WalletScoreService` + ежедневный cron (T4,T7) · sonnet, **opus-гейт: ревью весов/нормировки**
Файлы: `src/migrations/<ts>-AddWalletScores.ts`, `src/wallets/wallet-score.entity.ts`, `src/wallets/wallet-score.util.ts` (+ `.spec.ts`), `src/wallets/wallet-score.service.ts` (+ int-spec), `WalletScoreCronService`, job `smart-score-recalc` (jobId тоже без `:`).
Rolling 90d: realized PnL (нормированный), win rate по resolved, profit factor (учесть ноль убытков), специализация по `category`. Sample-size gate: **≥30 resolved сделок за окно**, иначе не в рейтинге.
**Порог винрейта `SMART_TOP_MIN_WIN_RATE` в ConfigService, дефолт 0.55 — НЕ наследовать `minWinRate=0.6` из `smart-wallets.service.ts:350,509`.**
Тесты: компоненты; profit factor при нуле убытков; gate 29 vs 30; граница винрейта 0.55; int — пересчёт пишет таблицу, <30 отсекается.

### T9. Rolling-автоисключение из smart whitelist (T8) · sonnet
Файлы: `src/wallets/smart-score-rolling.util.ts` (+ `.spec.ts`), интеграция в `WalletScoreCronService`. Переиспользовать `resolveDeactivations`/`upsert` из `smart-wallets.service.ts`.
Винрейт < порога (ConfigService) 2 недели подряд → деактивация + admin-пост. Тесты: 2 недели триггерят, прерывание сбрасывает.

### T10. `ADMIN_CHAT_ID` + admin-guard + `sendAdminAlert` (T0) · sonnet
Файлы: `src/telegram/admin-guard.util.ts` (+ `.spec.ts`), `src/telegram/telegram.service.ts` (`sendAdminAlert` через `getOrThrow("ADMIN_CHAT_ID")`), `src/telegram/telegram.update.ts` (гард на `/queues /errors /ws /alerts`).
Не-admin → молчание/отказ. Потребители: T6 (divergence/investigation), T9 (exclusion), T8 («мало кандидатов»).
Тесты: match/mismatch/env-absent; отказ не-admin в update.spec.

### T11. `/top` v2 из `wallet_scores` (T6,T8,T10) · sonnet
Файлы: `src/telegram/telegram.update.ts` (`handleTop` → `WalletScoreService.getTopByScore(10)`, **только `validated=true`**), `src/telegram/telegram.formatter.ts` (формат: лейбл, PnL 90d, винрейт, специализация, кол-во сделок; объём в конце мелко). `getTopWalletsByVolumeOnTopMarkets` остаётся внутренним.
Пул < 10 → показать сколько есть + admin-алерт «мало кандидатов» (не падать).
Тесты: formatter.spec — формат; невалидированные не показываются; деградация при малом пуле.

### T12. Чистка вывода (T10,T11) · sonnet, верификация формата — haiku
Файлы: `src/telegram/telegram.formatter.ts`, `src/wallets/wallets.service.ts`.
Убрать `WALLET_PNL_LIMITATIONS` + блоки Data gaps/Limitations из пользовательского вывода → одна строка `est. on-chain data · обновлено N мин назад` (время из `computed_at` снапшота). `/pnl` → v2-вывод. `formatStartMessage` без `/queues /errors /ws`.
Тесты: ноль disclaimers; одна служебная строка; `/start` чистый.

### T13. Финальная верификация Acceptance (T1–T12) · haiku прогон, **opus-гейт: вердикт по сходимости**
Файлы: `test/top-v2.e2e-spec.ts`, `test/admin-commands.e2e-spec.ts`.
- `/top`: ≤10 валидированных кошельков, все +PnL 90d, винрейт >55%, ≥30 сделок; ноль disclaimers; одна служебная строка.
- Сходимость с lb-api на all+30d в пределах ε (фикстуры).
- **Тест-кейс границы 30–90 дней**: 90d-сумма арифметически равна сумме операций окна, граница не теряет операции (условие Architect rec#5).
- Админ-команды: не-admin → отказ, admin → работают, `/start` без них.
- `npm run test` и `npm run typecheck` чистые.

## Граф зависимостей
T0 → {T1, T2, T3, T7, T10} ; {T1,T2,T3} → T4 → {T5, T6} ; T7+T4 → T8 → {T9, T11} ; T6+T8+T10 → T11 → T12 → T13.
Opus-гейты: T2+T6 (методология PnL), T8 (веса скоринга), T13 (вердикт).

## Чего НЕ делать в Фазе 1
Карточки алертов v2, авто-лейблы, divergence detector, виртуальный портфель, /copy backtest, монетизация, веб-страницы, хранение сырых activity (B1), новые источники данных.

## Backlog Phase B/C (очередь после Фазы 1)
Карточки алертов по кликбейт-формуле + фильтр отправки; детерминированные авто-лейблы + публичный username; divergence detector (`/score` → smart-money consensus vs цена); виртуальный копи-портфель + еженедельный отчёт; `/copy <addr>` backtest; разбор остаточных $3–37 (CONVERSION/negRisk — один живой запрос `type=CONVERSION` на кошельке-носителе); двухуровневый validated_strict/loose; переход на B1 при смене формулы; Redis-lock/repeatable при мульти-инстансе; M2M-категории.

## ADR
**Decision:** cash-flow PnL по `usdcSize` + MTM (`Σ positions.currentValue`), снапшоты `wallet_pnl_snapshots` с timestamp-watermark-синком; валидация против lb-api на all+30d с ε; `category` nullable в `markets`; `@Cron` → BullMQ `wallet-analytics`; `/top` из `wallet_scores` среди `validated=true`; операционка за `ADMIN_CHAT_ID`.
**Отвергнутые альтернативы:** онлайн-агрегация (rate limit/латентность/пул); сырые activity в Postgres (объём, follow-up); M2M-категории (оверинжиниринг); BullMQ repeatable (новый паттерн); **«acceptance=30d, PnL прямо из lb-api без движка» — продукт обещает 90d, lb-api без 90d-окна**; глобальный 6-ключ дедупа (эмпирически коллизирует на легитимных операциях).
**Consequences:** смена формулы = полная перекачка; cron на каждом инстансе (смягчено cron-jobId); одна категория на маркет; кошельки с необъяснённым diff $3–37 честно вне `/top` (known-unknown CONVERSION).
