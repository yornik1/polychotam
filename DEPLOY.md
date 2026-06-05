# Deploy: AWS EC2 t3.small

## Требования

- EC2 t3.small (2 vCPU, 2GB RAM)
- Swap: 2-4GB (обязательно при 2GB RAM)
- Ubuntu 22.04+ или Amazon Linux 2023
- Docker + Docker Compose v2
- Открыт порт 3000 (Security Group) — только для тебя или через Cloudflare Tunnel

## Первичная настройка сервера

```bash
# Swap (если ещё нет)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# перелогинься

# Репо
git clone https://github.com/yornik1/polychotam.git
cd polychotam
```

## Конфигурация

```bash
cp .env.example .env
nano .env
```

Обязательно заполнить:
- `DATABASE_URL=postgresql://postgres:СИЛЬНЫЙ_ПАРОЛЬ@postgres:5432/polychotam`
- `POSTGRES_PASSWORD=СИЛЬНЫЙ_ПАРОЛЬ` (тот же что в DATABASE_URL)
- `REDIS_URL=redis://redis:6379`
- `TELEGRAM_BOT_TOKEN=от @BotFather`
- `TELEGRAM_CHAT_ID=твой chat_id для алертов` (узнать: написать боту, посмотреть в логах или через @userinfobot)
- `POLYMARKET_WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/market`

## Запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## Миграции (первый раз)

```bash
# При обычном старте контейнера миграции применяются автоматически в docker-entrypoint.sh
# Если нужно прогнать вручную повторно:
docker compose -f docker-compose.prod.yml exec app node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
```

## Проверка

```bash
# Логи
docker compose -f docker-compose.prod.yml logs -f --tail 100 app

# Здоровье
curl http://localhost:3000/health

# Bull Board
# http://YOUR_IP:3000/queues (или через SSH tunnel: ssh -L 3000:localhost:3000 ec2-user@IP)

# Postgres
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d polychotam -c "SELECT COUNT(*) FROM trades;"
```

## Обновление

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Мониторинг

```bash
# RAM/swap
free -h

# Контейнеры
docker stats --no-stream

# Ошибки BullMQ
tail -n 20 logs/bull-job-errors.ndjson | jq .
```

## Telegram бот

После старта — пиши боту `/start`. Доступные команды:
- `/start` — приветствие
- `/top` — топ китов по объёму
- `/market <slug>` — инфо по маркету
- `/whales` — smart whale whitelist (после реализации)
- `/whale <address>` — детали кошелька
- `/stats` — статистика системы
- `/alerts on|off` — вкл/выкл real-time алерты

## Troubleshooting

- **OOM killed:** `docker compose -f docker-compose.prod.yml logs app | grep -i kill` — увеличь swap или уменьши memory limits
- **WS не подключается:** проверь `POLYMARKET_WS_URL`, должен быть `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- **Telegram 409 Conflict:** уже запущен другой инстанс бота с тем же токеном. Останови старый.
- **Postgres OOM:** уменьши `shared_buffers` до 64MB в docker-compose.prod.yml
