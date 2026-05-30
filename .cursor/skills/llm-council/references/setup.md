# LLM Council — настройка

## API-ключи

Добавь в `.env` в корне репозитория:

```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

- OpenAI: https://platform.openai.com/api-keys
- Gemini: https://aistudio.google.com/app/apikey

## Модели (опционально)

```
OPENAI_MODEL=gpt-5-nano
GEMINI_MODEL=gemini-3-flash-preview
```

| Профиль | OpenAI | Gemini |
|---------|--------|--------|
| По умолчанию (дешево) | gpt-5-nano | gemini-3-flash-preview |
| Баланс | gpt-5-mini | gemini-3-flash-preview |
| Качество | gpt-5.2 | gemini-3-pro-preview |

Каждый вызов council = 2 API-запроса (ChatGPT + Gemini).

## CLI (предпочтительно)

Если установлены `codex` и `gemini` CLI — скрипт использует их без расхода API-ключей из `.env`.

## Проверка

```bash
python3 .cursor/skills/llm-council/scripts/query_llms.py "Краткий тест: один абзац про NestJS модули"
```

Ожидается JSON с полями `chatgpt` и `gemini`.

## Зависимости

Скрипт использует только стандартную библиотеку Python 3 — `pip install` не нужен.
