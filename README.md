# polychotam

Backend на NestJS для мониторинга маркетов Polymarket: подписка на CLOB WebSocket, обогащение сделок, агрегаты по кошелькам, алерты в Telegram.

## Стек

- NestJS + TypeScript (`strict: true`)
- PostgreSQL + TypeORM (миграции, `synchronize` отключён)
- Redis + BullMQ (очереди, Bull Board UI)
- WebSocket клиент Polymarket CLOB (`ws`)
- Telegram (`nestjs-telegraf`)
- Vitest (unit + e2e)
- Docker Compose

## Что внутри сейчас

```
src/
  markets/        — entity маркетов, sync с Polymarket
  trades/         — сделки (entity, обработка)
  wallets/        — кошельки и кэш агрегатов P&L
  queue/          — 3 BullMQ-процессора: trades, trade-enrichment, wallet-analytics
                    + NDJSON-логирование ошибок джобов
  polymarket/     — WS-клиент CLOB, REST-клиент, Gamma API + cron, backfill истории
  settings/       — глобальные флаги приложения и настройки алертов
  telegram/       — бот, форматтер сообщений, дедуп алертов
  common/         — общие утилиты
  migrations/     — миграции TypeORM
  types/          — `contracts.ts` — единый источник типов проекта
```

## Запуск

### Через Docker Compose (полный стек: app + postgres + redis)

```bash
cp .env.example .env
# проставить TELEGRAM_BOT_TOKEN
docker compose up --build
```

Что поднимется:
- `app` на http://localhost:3000
- `postgres` на localhost:5432 (db `polychotam`, user/pass `postgres/postgres`)
- `redis` на localhost:6379

### Локально (приложение на хосте, БД и Redis в Docker)

```bash
cp .env.example .env
# заменить host postgres → localhost, redis → localhost в DATABASE_URL/REDIS_URL
docker compose up -d postgres redis
npm install
npm run migration:run
npm run start:dev
```

## Миграции

`migration:run/revert/generate` сами включают `nest build` — отдельный `npm run build` перед ними не нужен. Datasource подключается из `dist/data-source.js`.

```bash
npm run migration:run                                       # применить все
npm run migration:revert                                    # откатить последнюю
npm run migration:generate -- src/migrations/ИмяМиграции    # diff entity → миграция
npm run migration:create -- src/migrations/ИмяМиграции      # пустой файл
```

## Команды

```bash
npm run test           # vitest run, один проход
npm run test:watch     # vitest в watch-режиме
npm run typecheck      # tsc --noEmit, без сборки
npm run lint           # eslint
npm run build          # nest build
npm run start:dev      # nest start --watch
```

## Где что смотреть, когда упало

Сначала — три места по убыванию полезности:

1. **Bull Board UI** — http://localhost:3000/queues
   Состояние очередей `trades`, `trade-enrichment`, `wallet-analytics`: активные, ожидающие, упавшие джобы, payload, stack trace. Главное окно для очередей.

2. **NDJSON ошибок джобов** — `logs/bull-job-errors.ndjson`

   ```bash
   tail -n 50 logs/bull-job-errors.ndjson | jq .
   ```

   Через docker compose файл монтируется в `./logs/` локально (см. `volumes` в [docker-compose.yml](docker-compose.yml)).

3. **Логи приложения** — `docker compose logs -f --tail 200 app`

   Внимание: в [src/main.ts](src/main.ts) стоит `logger: ["error"]` — info/warn от NestJS подавлены, в логах будут только ошибки. Для глубокого дебага временно поднять уровень.

Дальше — слой за слоем:

- **Postgres**: `docker compose exec postgres psql -U postgres -d polychotam`
- **Redis** / ключи BullMQ: `docker compose exec redis redis-cli` → `KEYS "bull:*"`
- **Один тест точечно**: `npm run test -- src/queue/trade-enrichment.processor.spec.ts -t "имя теста"`
- **Типы**: `npm run typecheck`
- **WebSocket Polymarket**: проверить `POLYMARKET_WS_URL` — должен быть `wss://ws-subscriptions-clob.polymarket.com/ws/market` (адрес `wss://clob.polymarket.com/ws/market` отдаёт 404 при handshake).

Для развёрнутого сценария дебага есть скилл [.cursor/skills/debug/SKILL.md](.cursor/skills/debug/SKILL.md).

## Переменные окружения

Все читаются через `ConfigService`. Список и комментарии — в [.env.example](.env.example).

Критичные (без них не стартует):
- `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `POLYMARKET_WS_URL`
