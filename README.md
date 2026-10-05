# polychotam

NestJS backend that monitors Polymarket markets: subscribes to the CLOB WebSocket, enriches trades, keeps per-wallet aggregates and sends alerts to Telegram.

## Stack

- NestJS + TypeScript (`strict: true`)
- PostgreSQL + TypeORM (migrations, `synchronize` disabled)
- Redis + BullMQ (queues, Bull Board UI)
- Polymarket CLOB WebSocket client (`ws`)
- Telegram (`nestjs-telegraf`)
- Vitest (unit + e2e)
- Docker Compose

## Layout

```
src/
  markets/        market entity, sync with Polymarket
  trades/         trades (entity, processing)
  wallets/        wallets and cached P&L aggregates
  queue/          3 BullMQ processors: trades, trade-enrichment, wallet-analytics
                  + NDJSON logging of failed jobs
  polymarket/     CLOB WS client, REST client, Gamma API + cron, history backfill
  settings/       global app flags and alert settings
  telegram/       bot, message formatter, alert dedup
  common/         shared utilities
  migrations/     TypeORM migrations
  types/          contracts.ts, single source of project types
```

## Run

### Docker Compose (full stack: app + postgres + redis)

```bash
cp .env.example .env
# set TELEGRAM_BOT_TOKEN
docker compose up --build
```

This starts:
- `app` on http://localhost:3000
- `postgres` on localhost:5432 (db `polychotam`, user/pass `postgres/postgres`)
- `redis` on localhost:6379

### Local (app on the host, database and Redis in Docker)

```bash
cp .env.example .env
# replace host postgres -> localhost, redis -> localhost in DATABASE_URL/REDIS_URL
docker compose up -d postgres redis
npm install
npm run migration:run
npm run start:dev
```

## Migrations

`migration:run/revert/generate` run `nest build` themselves, no separate `npm run build` is needed. The datasource is loaded from `dist/data-source.js`.

```bash
npm run migration:run                                         # apply all
npm run migration:revert                                      # revert the last one
npm run migration:generate -- src/migrations/MigrationName    # entity diff -> migration
npm run migration:create -- src/migrations/MigrationName      # empty file
```

## Commands

```bash
npm run test           # vitest run, single pass
npm run test:watch     # vitest in watch mode
npm run typecheck      # tsc --noEmit, no build
npm run lint           # eslint
npm run build          # nest build
npm run start:dev      # nest start --watch
```

## Where to look when something fails

Three places first, most useful on top:

1. **Bull Board UI**: http://localhost:3000/queues
   State of the `trades`, `trade-enrichment` and `wallet-analytics` queues: active, waiting and failed jobs, payload, stack trace.

2. **NDJSON log of failed jobs**: `logs/bull-job-errors.ndjson`

   ```bash
   tail -n 50 logs/bull-job-errors.ndjson | jq .
   ```

   With docker compose the file is mounted into `./logs/` (see `volumes` in [docker-compose.yml](docker-compose.yml)).

3. **Application logs**: `docker compose logs -f --tail 200 app`

   Note: [src/main.ts](src/main.ts) sets `logger: ["error"]`, so NestJS info/warn output is suppressed and only errors are logged. Raise the level temporarily for deeper debugging.

Then layer by layer:

- **Postgres**: `docker compose exec postgres psql -U postgres -d polychotam`
- **Redis** / BullMQ keys: `docker compose exec redis redis-cli` → `KEYS "bull:*"`
- **A single test**: `npm run test -- src/queue/trade-enrichment.processor.spec.ts -t "test name"`
- **Types**: `npm run typecheck`
- **Polymarket WebSocket**: check `POLYMARKET_WS_URL`, it must be `wss://ws-subscriptions-clob.polymarket.com/ws/market` (`wss://clob.polymarket.com/ws/market` returns 404 on handshake).

## Environment variables

All of them are read through `ConfigService`. The full list with comments is in [.env.example](.env.example).

Required (the app does not start without them):
- `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `POLYMARKET_WS_URL`

Deployment notes are in [DEPLOY.md](DEPLOY.md).
