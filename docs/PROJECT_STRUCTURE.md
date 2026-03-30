# Структура проекта

## Доменные модули

- `markets` — данные и логика по маркетам Polymarket
- `trades` — обработка входящих сделок
- `wallets` — кошельки и расчёт P&L
- `queue` — очереди задач (BullMQ)
- `polymarket` — WebSocket-интеграция с Polymarket CLOB API
- `telegram` — Telegram-бот и команды
- `common` — общие утилиты, guards, interceptors

## Технические правила

- TypeScript в строгом режиме
- Запрещён `any`
- Каждый модуль изолирован и импортирует только нужные зависимости
- Доступ к env только через `ConfigService`
