---
name: notion-sprints
description: "[Polychotam] Work with Михаил's Notion sprint/task system: inspect current sprint, fetch related tasks, rank what to do next, and preserve decision authority before code changes."
---

# Notion Sprints — Polychotam

Use this skill when the user asks about Notion sprints, current sprint tasks, what to do next, sprint planning/review, task priority, or whether a task is worth doing now.

## Sources

Prefer the Notion connector when available.

- Tasks data source: `collection://38153be9-6c46-43ea-968a-89bd5f2bbc60` (`📋 Задачи`)
- Main Sprints data source: `collection://3797b5e2-ccce-803c-bad6-000b819adcff` (`Sprints`)
- Legacy/Russian Sprints data source: `collection://9e68520e-45cd-44ef-beea-c0156f0bbfe5` (`🗓 Спринты`)

Tasks may contain both `Sprint` and `Спринт`. Prefer the main `Sprints` database when it has a `Sprint status = Current`; use the Russian sprint relation as corroboration or fallback.

## Workflow

1. Fetch the relevant sprint:
   - If the user provides a sprint/task URL, fetch that first.
   - Otherwise identify the current sprint from `Sprints` by `Sprint status = Current`.
   - If SQL/query tools fail, use Notion search/fetch and the relation lists on the sprint page.
2. Fetch related task pages from the sprint relation.
3. For each task, read only properties and core sections: `Зачем`, `Acceptance criteria`, `DoD`, `Test spec`, `Prod check`, `Commit`.
4. Summarize tasks in Russian with: title, status, priority, track/epic, business value, confidence, and next proof step.
5. Rank recommendations by the user's actual goal, not by ease of coding.

## Ranking Heuristics

For "restore trust in product / Codex / SDLC", prefer tasks that:

- verify prod data and upstream contracts before adding code;
- produce a user-visible Telegram flow that the user can inspect;
- reduce hallucination/noise in market or wallet signals;
- have a clear prod check and falsifiable acceptance criteria;
- distinguish business meaning from implementation success.

Down-rank tasks that:

- are vague, personal, deleted, or unrelated to Polychotam product;
- add agent/process machinery before product evidence;
- require broad implementation before the data contract is proven.

## Decision Boundary

Do not start coding from a sprint recommendation unless the user explicitly chooses a task or asks to implement. For ambiguous "what next?" prompts, answer with a ranked recommendation and the evidence from Notion. If code changes are later requested, use the task page as the contract and verify against its `Test spec` and `Prod check`.

If a task is marked `Готово`/`Done` but its internal DoD checkboxes are unchecked, call this out as a process smell rather than assuming the task is truly done.

## Output Shape

Keep it short unless the user asks for a full sprint review:

- "I would do X first" with why.
- 2-4 alternatives and why they rank lower.
- Explicit note of unknowns or checks needed before code.
- No Notion writes unless the user asks to update Notion.
