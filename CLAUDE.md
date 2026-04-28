# Polychotam — Claude Code Guide

Язык: русский.

Ответы: без вступлений, без ASCII-оформления, без резюме в конце.

Документацию в репозитории не добавлять и не расширять, если пользователь явно не попросил.

Минимальные изменения кода: не переписывать то, что уже работает.

## Текущий проект

- Notion-борд: https://www.notion.so/9bdc07518c0546eaa9aa84e6f9bd0483
- Текущая задача: https://www.notion.so/33b7b5e2ccce81c48931c1701ef3bbc8 (Telegram бот)
- Подход: TDD (Test-Driven Development)

## Архитектура

- Следовать модульной структуре NestJS из `docs/PROJECT_STRUCTURE.md`
- Сохранять изоляцию модулей: импортировать только необходимые модули
- Общие абстракции выносить в `common`
- Перед архитектурными изменениями сверяться с `docs/PROJECT_STRUCTURE.md`

## TypeScript

- Строгая типизация, не использовать `any`
- Предпочитать явные типы для публичных методов сервисов

## Конфигурация

- Читать переменные окружения только через `ConfigService`
- Проверять обязательные env через `getOrThrow`

## Стек и интеграции

NestJS, TypeScript, Docker Compose.

- PostgreSQL: TypeORM (`@nestjs/typeorm`)
- Redis и очереди: BullMQ (`@nestjs/bullmq`)
- Telegram: `nestjs-telegraf`
- WebSocket: встроенные средства NestJS

## Контракты типов

Файл `src/types/contracts.ts` — единый источник контрактов; использовать его всегда, где применимо.

Не дублировать типы локально, если нужный тип уже объявлен в `contracts.ts`.

## Персистенс (TypeORM / PostgreSQL)

- Сущности: `*.entity.ts` рядом с доменными модулями (`markets`, `trades`, `wallets`)
- **Имена колонок** в БД и в entity совпадают с полями **CLOB API** и типами **`@polymarket/clob-client`** (например `condition_id`, `market_slug`, `volume24hr`, `end_date_iso`, в сделках — `market`, `asset_id`, `match_time`, `maker_orders` и т.д.)
- Поля только приложения — с префиксом **`internal_`** (`internal_synced_at`, `internal_created_at`, `internal_updated_at` у маркетов; у `wallets` — `internal_updated_at` для времени пересчёта агрегатов)
- Внешние HTTP DTO (например `MarketDto` с camelCase) **не обязаны** повторять Polymarket; маппинг DTO ↔ entity — в сервисах
- Миграции: `src/migrations/`. `synchronize` отключён — схема только через миграции
- Команды (перед этим нужен **`npm run build`**, datasource подключается из **`dist/data-source.js`**):
  - применить: `npm run migration:run`
  - откатить последнюю: `npm run migration:revert`
  - сгенерировать по diff: `npm run migration:generate -- src/migrations/ИмяМиграции`
  - пустой файл: `npm run migration:create -- src/migrations/ИмяМиграции`

## Комментарии

- Комментарии в коде писать на русском

## Тестирование

- Используется Vitest для unit и e2e тестов
- Тесты размещаются рядом с кодом: `*.spec.ts`
- E2E тесты в папке `test/`
- Запуск: `npm run test`

## Git и коммиты

- Коммиты на английском в формате conventional commits
- Префиксы: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`
- Пример: `feat(markets): add gamma top markets endpoint`

## Документация проекта

- `docs/PROJECT_STRUCTURE.md` — структура модулей и правила персистенса
- `docs/archive/specs/` — спецификации фич
- `docs/archive/plans/` — планы реализации
- Не создавать новую документацию без явного запроса
