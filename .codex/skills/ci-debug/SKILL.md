---
name: ci-debug
description: "[Polychotam] Разобрать красный GitHub Actions workflow: читать только failed step, найти минимальный fix и прогнать focused checks."
---

# CI Debug

Использовать, когда пользователь пишет `$ci-debug`, говорит что GitHub workflow красный, или спрашивает почему deploy failed.

## Workflow

1. Найти run:
   - если дали URL — использовать его;
   - иначе через `gh run list` найти последний failed run.
2. Читать только failed jobs/steps. Не тащить полный лог.
3. Классифицировать failure:
   - lint/typecheck/test/build;
   - SSH/deploy;
   - health check;
   - secrets/network/runtime.
4. Смотреть минимальный набор локальных файлов.
5. Если это code/config issue — внести минимальный fix.
6. Сначала rerun focused local check, потом broader checks если нужно.

## Fallback

Если `gh` недоступен или не авторизован — попросить run URL или failed-step log. Не гадать по памяти.

## Output Shape

- `Failed step`
- `Cause`
- `Fix`
- `Verified by`
- `Still unknown`, only when relevant
