# Структура проекта

## Доменные модули

- `markets` — данные и логика по маркетам Polymarket
- `trades` — обработка входящих сделок
- `wallets` — кошельки и расчёт P&L
- `queue` — очереди задач (BullMQ)
- `polymarket` — WebSocket-интеграция с Polymarket CLOB API
- `settings` — глобальные настройки приложения и флаги алертов
- `telegram` — Telegram-бот и команды
- `common` — общие утилиты, guards, interceptors

## Персистенс (TypeORM / PostgreSQL)

- Сущности: `*.entity.ts` рядом с доменными модулями (`markets`, `trades`, `wallets`).
- **Имена колонок** в БД и в entity совпадают с полями **CLOB API** и типами **`@polymarket/clob-client`** (например `condition_id`, `market_slug`, `volume24hr`, `end_date_iso`, в сделках — `market`, `asset_id`, `match_time`, `maker_orders` и т.д.). Поля только приложения — с префиксом **`internal_`** (`internal_synced_at`, `internal_created_at`, `internal_updated_at` у маркетов; у `wallets` — `internal_updated_at` для времени пересчёта агрегатов).
- Внешние HTTP DTO (например `MarketDto` с camelCase) **не обязаны** повторять Polymarket; маппинг DTO ↔ entity — в сервисах.
- Миграции: `src/migrations/`. `synchronize` отключён — схема только через миграции.
- Datasource подключается из **`dist/data-source.js`**. Команды `migration:run/revert/generate` **сами включают `nest build`** — отдельный `npm run build` перед ними не нужен:
  - применить: `npm run migration:run`
  - откатить последнюю: `npm run migration:revert`
  - сгенерировать по diff: `npm run migration:generate -- src/migrations/ИмяМиграции`
  - пустой файл: `npm run migration:create -- src/migrations/ИмяМиграции`
- Таблица **`wallets`**: в CLOB нет такого объекта; это **кэш агрегатов** (`total_won`, `total_lost`, `win_rate`). Источник истины — правила PnL и разрешённые маркеты; пересчёт — отдельными воркерами/джобами (спека позже). Поле **`internal_updated_at`** — время последнего пересчёта.

## Технические правила

- TypeScript в строгом режиме
- Запрещён `any`
- Каждый модуль изолирован и импортирует только нужные зависимости
- Доступ к env только через `ConfigService`
