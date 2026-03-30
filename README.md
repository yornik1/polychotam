# polychotam

Базовая инициализация backend-проекта на NestJS для работы с маркетами Polymarket, сделками, кошельками, очередями и Telegram.

## Стек

- NestJS + TypeScript (`strict: true`)
- PostgreSQL + TypeORM
- Redis + BullMQ
- WebSockets (NestJS WS)
- Telegram бот (`nestjs-telegraf`)
- Docker Compose

## Структура модулей

```text
src/
  app.module.ts
  markets/
  trades/
  wallets/
  queue/
  polymarket/
  telegram/
  common/
```

## Быстрый старт (локально)

1. Скопировать переменные окружения:

```bash
cp .env.example .env
```

2. Установить зависимости:

```bash
npm install
```

3. Запустить приложение в dev-режиме:

```bash
npm run start:dev
```

## Запуск через Docker Compose

1. Подготовить `.env`:

```bash
cp .env.example .env
```

2. Запустить сервисы:

```bash
docker compose up --build
```

Поднимутся сервисы:
- `app` на `http://localhost:3000`
- `postgres` на `localhost:5432`
- `redis` на `localhost:6379`

## Переменные окружения

- `DATABASE_URL` — строка подключения к PostgreSQL
- `REDIS_URL` — строка подключения к Redis
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота
- `POLYMARKET_WS_URL` — URL WebSocket API Polymarket

Все env-переменные читаются через `ConfigService`.

## Следующие шаги

- Добавить entities и миграции TypeORM
- Реализовать producers/consumers в `queue`
- Реализовать WebSocket клиент Polymarket в `polymarket`
- Добавить Telegram handlers в `telegram`
