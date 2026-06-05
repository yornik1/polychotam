---
name: deploy-smoke
description: "[Polychotam] Проверить deploy-ec2 после выката: workflow status, /health, короткие логи и нужное Telegram-поведение."
---

# Deploy Smoke

Использовать, когда пользователь пишет `$deploy-smoke` или спрашивает, сработал ли EC2 deploy.

## Workflow

1. Проверить последний `Deploy EC2 (SSH)` workflow run.
2. Если run красный — перейти в поведение `$ci-debug` и читать только failed step.
3. Если run зелёный — проверить prod:
   - `/health`;
   - короткие `app` logs, если доступны;
   - BullMQ/WS logs, если задача касается очередей или stream;
   - нужную Telegram-команду или поведение, если задача Telegram-facing.
4. Не делать destructive prod changes. Для действий, которые пишут prod data или шлют реальные сообщения пользователям, нужно явное подтверждение.

## Output Shape

- `Workflow`
- `Health`
- `Feature smoke`
- `Logs`
- `Result`
