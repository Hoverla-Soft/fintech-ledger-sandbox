---
description: Sync documentation for a feature that already exists in code, without running the full feature-loop
argument-hint: <path to docs/tasks/*.md, a PR/diff description, or a short feature description>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

Use this when behavior was already implemented (legacy code, a manual change, work done outside `/feature-loop`) and only the documentation needs to catch up. Do not use this to write a new spec before implementation — that's `product-analyst` via `/feature-loop`, not this command.

## 1. Gather context

- If `$ARGUMENTS` is a path under `docs/tasks/`, read it and its Related docs.
- If it names or points to a PR/diff/branch, get the actual change (`git diff`, `git log`, or the referenced files) instead of guessing from the description alone.
- If it's a short feature description with no path or diff, ask which files/area it touches before proceeding — don't scan the whole repo to guess.
- Read the existing docs that plausibly cover the area: `README.md`, `SETUP-GUIDE*.md`, `docs/development/`, `docs/backend/`, `docs/frontend/`, `docs/product/`, `docs/integrations/`, `docs/test-coverage.md`.

## 2. Scope this to documentation only

Write `.claude/.active-task-scope.json` with a scope limited to documentation paths plus whatever specific source files are needed for context reading (Read isn't blocked by scope-guard, only Edit/Write/NotebookEdit are, but keep the declared scope narrow anyway):

```json
{"taskFile": "$ARGUMENTS", "scope": ["docs/**", "README.md", "SETUP-GUIDE*.md", "TEAM-AGENTS.md"]}
```

This is what stops a documentation pass from turning into an accidental code edit.

## 3. Dispatch documentator-agent

Hand off the gathered context (task file contents, diff, or confirmed area) and ask it to document only behavior it can verify from code/tests/spec — never invent an endpoint, command, config value, or product decision. If code and an existing spec disagree, it reports the drift instead of silently picking a side.

## 4. Report and clean up

Report: documents updated and why, documents intentionally left unchanged, and any unresolved code/spec/doc drift (log genuine open questions in `docs/open-questions.md`). Remove `.claude/.active-task-scope.json` when done so it doesn't linger and restrict an unrelated later session.
