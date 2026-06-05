---
name: start-task
description: "[Polychotam] Начать работу по Notion-задаче: достать проблему, DoD, test spec, prod check и название задачи для commit message."
---

# Start Task

Использовать, когда пользователь пишет `$start-task <url-or-title>` или просит начать задачу Polychotam из Notion.

## Workflow

1. Если есть URL — открыть Notion-задачу; если есть только название — найти задачу в актуальной базе.
2. Вытащить только полезный контекст:
   - какую боль решаем и для кого;
   - какой результат должен увидеть пользователь;
   - acceptance criteria / DoD;
   - test spec;
   - prod validation;
   - точную строку `Task: <title>` для commit body.
3. Если задача размыта, сначала посмотреть repo и вывести минимальный путь реализации. Спрашивать только когда без продуктового решения можно сделать не то.
4. Начинать с самого маленького проверяемого поведения. Для тестируемых фич — сначала focused test.
5. Работать в `main`; ветки не создавать без прямой просьбы.

## Output Shape

Вернуть короткий execution brief:

- `Task`
- `Problem`
- `DoD`
- `Test spec`
- `Prod check`
- `First action`

Если задача уже actionable — продолжать реализацию.
