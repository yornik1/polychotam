# Polymarket CLOB WebSocket — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec (утверждена):** `docs/superpowers/specs/2026-04-01-polymarket-clob-websocket-design.md`

**Goal:** Исходящий WebSocket-клиент к Polymarket CLOB: при старте — лог успешного подключения; топ-20 маркетов по `volume24hr`; подписка по формату, подтверждённому шагом сверки; сырые сообщения в `Logger.debug`; распознанные сделки → строгий `TradeEvent` и `Logger.log` (кошелёк, сумма, маркет и др.); автопереподключение через 5 с; без очередей, БД и `console.log`.

**Architecture:** Отдельный `PolymarketWsClient` в `PolymarketModule` (`OnModuleInit` / `OnModuleDestroy`). Чистая функция отбора топ-20 из `PolymarketMarketRaw[]`. Отдельный парсер WS JSON → `TradeEvent | null` (или массив сделок), только NestJS `Logger` в клиенте. `trade-event.ts` — только типы сделки, без полей типа `unknown`.

**Tech Stack:** NestJS, TypeScript strict, `ws`, Vitest (`npm run test`).

---

## Карта файлов

| Файл | Назначение |
|------|------------|
| `src/polymarket/dto/trade-event.ts` | Интерфейс/типы одной сделки (без `unknown` в полях сделки) |
| `src/polymarket/dto/trade-event.spec.ts` | Минимальный тест / assignability |
| `src/polymarket/polymarket-top-markets.ts` | `pickTopMarketsByVolume(raw, limit)` — чистая функция |
| `src/polymarket/polymarket-top-markets.spec.ts` | Юнит-тесты топ-20 |
| `src/polymarket/polymarket-ws-trade.parser.ts` | Парсинг тела сообщения → сделки (без I/O) |
| `src/polymarket/polymarket-ws-trade.parser.spec.ts` | Фикстуры JSON → `TradeEvent` / пусто |
| `src/polymarket/polymarket-ws.client.ts` | Сокет, подписка, логи, reconnect |
| `src/polymarket/polymarket.module.ts` | Регистрация провайдера |
| `package.json` / `package-lock.json` | Зависимость `ws`, dev `@types/ws` |

`PolymarketGateway` не использовать для соединения с Polymarket.

---

### Task 0: Сверка формата CLOB WebSocket

**Files:** нет кода (или краткий комментарий в `polymarket-ws.client.ts` после решения)

- [ ] **Step 1:** По официальной документации Polymarket CLOB WebSocket и/или одному живому сеансу зафиксировать: URL (сверить с `POLYMARKET_WS_URL` в `.env.example`), **точную форму сообщения подписки** (имена полей: `type`, список id — `condition_id` vs `token_id` / `assets` и т.д.), **форму входящих trade-событий** (поля для кошелька, размера, стороны, цены, маркета/актива, времени).

- [ ] **Step 2:** Записать вывод одной фразой в реализации (комментарий у подписки + при необходимости обновить фикстуры в Task 3). Если дока и факт расходятся — следовать рабочему payload.

---

### Task 1: `pickTopMarketsByVolume` (TDD)

**Files:**
- Create: `src/polymarket/polymarket-top-markets.ts`
- Create: `src/polymarket/polymarket-top-markets.spec.ts`

Импорты в стиле проекта: суффикс `.js`. Тип аргумента — `PolymarketMarketRaw[]` из `src/polymarket/dto/polymarket-market.raw.js`.

- [ ] **Step 1: Написать падающий тест**

Пример: три маркета с разным `volume24hr` → функция возвращает 2 id с наибольшим объёмом при `limit=2`; маркеты без `condition_id` отфильтровать; при равном объёме — стабильный порядок (например по исходному индексу).

- [ ] **Step 2: Запустить тест**

Run: `npm run test -- src/polymarket/polymarket-top-markets.spec.ts`  
Expected: FAIL (нет реализации).

- [ ] **Step 3: Реализовать минимально**

Функция возвращает `string[]` идентификаторов для подписки (после Task 0 — либо `String(condition_id)`, либо извлечённые `token_id` из `tokens`, как требует WS).

- [ ] **Step 4: Запустить тест**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/polymarket/polymarket-top-markets.ts src/polymarket/polymarket-top-markets.spec.ts
git commit -m "feat(polymarket): pick top markets by volume24hr"
```

---

### Task 2: `TradeEvent` DTO

**Files:**
- Create: `src/polymarket/dto/trade-event.ts`
- Create: `src/polymarket/dto/trade-event.spec.ts` (минимум один тест)

- [ ] **Step 1:** Описать поля по результату Task 0 (строки/числа, `side` как `"BUY" | "SELL"` или расширенный union **без** `unknown`).

Пример каркаса (поля уточнить по payload):

```typescript
export type TradeSide = "BUY" | "SELL";

export interface TradeEvent {
  wallet: string;
  amount: string;
  side: TradeSide;
  price: string;
  market: string;
  timestamp: number;
}
```

- [ ] **Step 2:** Добавить минимальный `src/polymarket/dto/trade-event.spec.ts` (хотя бы один тест на валидный объект) — файл **обязателен**, чтобы шаг коммита не ломался.

- [ ] **Step 3:** `npm run test` и `npm run build` — зелёные.

- [ ] **Step 4: Commit**

```bash
git add src/polymarket/dto/trade-event.ts src/polymarket/dto/trade-event.spec.ts
git commit -m "feat(polymarket): add TradeEvent DTO"
```

---

### Task 3: Парсер trade из WS (TDD)

**Files:**
- Create: `src/polymarket/polymarket-ws-trade.parser.ts`
- Create: `src/polymarket/polymarket-ws-trade.parser.spec.ts`

- [ ] **Step 1:** Ввести узкие типы для **входа** (например `JsonValue` как рекурсивный union из `null | boolean | number | string | JsonValue[] | { readonly [k: string]: JsonValue }`) **или** отдельный интерфейс сырого элемента с опциональными полями — **не** смешивать с `TradeEvent`. В `trade-event.ts` по-прежнему нет `unknown`.

- [ ] **Step 2:** Функция `parseTradeEventsFromWsPayload(parsed: unknown): TradeEvent[]` — внутри type guards; при невалидном JSON вызывающий код ловит; парсер не бросает на произвольной структуре, возвращает `[]`.

- [ ] **Step 3:** Тесты с JSON-строками из Task 0 (массив событий, один trade, не-trade, битый JSON — обработка на границе клиента).

Run: `npm run test -- src/polymarket/polymarket-ws-trade.parser.spec.ts`  
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/polymarket/polymarket-ws-trade.parser.ts src/polymarket/polymarket-ws-trade.parser.spec.ts
git commit -m "feat(polymarket): parse CLOB WS payload to TradeEvent"
```

---

### Task 4: Зависимости `ws`

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1:**

```bash
npm install ws
npm install -D @types/ws
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ws dependency for Polymarket CLOB client"
```

---

### Task 5: `PolymarketWsClient`

**Files:**
- Create: `src/polymarket/polymarket-ws.client.ts`
- Modify: `src/polymarket/polymarket.module.ts`

- [ ] **Step 1:** Зарегистрировать провайдер и экспорт при необходимости:

```typescript
import { PolymarketWsClient } from "./polymarket-ws.client.js";

// providers: ..., PolymarketWsClient
// exports: при необходимости для тестов/других модулей
```

- [ ] **Step 2:** Реализовать клиент. Инжектировать **`PolymarketHttpClient`** (уже есть в модуле), вызывать **`fetchMarkets()`**.

  - Вся последовательность «HTTP → топ-20 → WebSocket → подписка» живёт в **одном** методе (например `connect()`). `scheduleReconnect` вызывает **снова этот же метод**, чтобы при **любой** ошибке до/после открытия сокета повторялся **полный цикл**, а не только пересоздание сокета без свежего списка маркетов.
  - `ConfigService.getOrThrow("POLYMARKET_WS_URL")`.
  - `onModuleInit`: `await connect()` (или fire-and-forget с обработкой ошибок внутри `connect`).
  - `open`: лог «WS подключился», отправить JSON подписки (форма из Task 0).
  - `message`: `rawData = data.toString()`, `this.logger.debug` с сырым телом; `JSON.parse` в try/catch — при ошибке `warn`; иначе `parseTradeEventsFromWsPayload` → для каждого `TradeEvent` один `this.logger.log` с кошельком, суммой, маркетом (и сторона/цена по спеке).
  - `close` / `error`: лог, `scheduleReconnect` 5 с (константа в файле). `scheduleReconnect` идемпотентен: перед новым таймером сбрасывать предыдущий, чтобы не было двойного reconnect при паре событий подряд.
  - `onModuleDestroy`: `isDestroyed = true`, очистить таймер, `removeAllListeners("close")`, `ws.close()`.
  - Ошибка HTTP внутри `connect`: `error` лог, закрыть/обнулить сокет при необходимости, `scheduleReconnect` — снова полный `connect()` после backoff, без tight loop.

- [ ] **Step 3:** Убедиться, что в новых файлах нет `console.log`.

- [ ] **Step 4:**

Run: `npm run build`  
Run: `npm run test`  
Expected: успех.

- [ ] **Step 5: Commit**

```bash
git add src/polymarket/polymarket-ws.client.ts src/polymarket/polymarket.module.ts
git commit -m "feat(polymarket): CLOB WebSocket client with reconnect and trade logging"
```

---

### Task 6: Ручная проверка (критерии спеки)

- [ ] Запуск приложения: в логах есть явное сообщение о подключении WS.
- [ ] Имитация обрыва (отключение сети / блокировка исхода): через ~5 с снова **полный** цикл `fetchMarkets` → топ-20 → новый сокет → подписка (согласовано со спекой «при переподключении заново топ-20»).
- [ ] Уровень логов NestJS: для сырых сообщений видно строки при `LOG_LEVEL=debug` (или эквивалент в вашей конфигурации).
- [ ] Если в Task 0 выяснилось расхождение URL с `.env.example` — обновить `.env.example` и/или комментарий у `POLYMARKET_WS_URL`.

---

## Ссылки на навыки

- Реализация по шагам: @superpowers:subagent-driven-development или @superpowers:executing-plans
- Перед заявлением «готово»: @superpowers:verification-before-completion
