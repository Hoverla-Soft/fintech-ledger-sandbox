# Task Archive

Archived task files are short-term historical records, not the current source of truth.

Use this folder for tasks that reached `Done`, `Cancelled`, or `Superseded`.

## Structure

- `docs/tasks/archive/YYYY/` stores archived task files for that year.
- `docs/tasks/archive/YYYY/index.md` summarizes old tasks when individual files are pruned.

## Pruning Rules

Do not prune an archived task while it is still the only record of an important product decision, architecture decision, external source reference, acceptance criterion, verification result, unresolved risk, or review outcome.

Before pruning a task file:

- confirm durable decisions are captured in product, architecture, frontend/backend, integration, testing, or operations docs;
- preserve a short entry in the year index with the task title or ID, final status, related docs, related PR/commit/release when known, and one-line outcome;
- keep the full task file if audit, release review, or near-term follow-up still needs it.
