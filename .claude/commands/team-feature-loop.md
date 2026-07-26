---
description: Run a cross-layer feature with experimental Claude Code Agent Teams and per-session task scopes
argument-hint: <feature request or docs/tasks/*.md>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, TaskCreate, TaskGet, TaskList, TaskUpdate, SendMessage
---

Run $ARGUMENTS as an experimental Agent Teams workflow. Follow `TEAM-AGENTS.md` and the normal `/feature-loop` quality stages. Do not use a team when the work is sequential, edits the same files, or is too small to justify the coordination/token cost.

## Preconditions

1. Confirm the installed Claude Code version supports Agent Teams (`claude --version`) and follow the current official version requirement.
2. Confirm `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is active. If it is not, stop and show the opt-in instructions from `TEAM-AGENTS.md`; settings changes require restarting Claude Code.
3. Complete spec and architecture decisions before parallel implementation. Ensure the task includes typecheck, lint, tests, and build.

## Plan ownership before spawning

Partition the task into independent file ownership. Shared contracts, schemas, architecture decisions, and generated files must have exactly one owner and should be completed before dependent parallel work. Do not assign two teammates overlapping files.

Prefer 3–5 teammates only when justified. Reuse project agent types, for example:

- `backend-agent` for API/core/DB implementation;
- `frontend-agent` for the frontend app;
- `integration-agent` for external-provider code;
- `qa-agent` for disjoint test files;
- review-only agent types for parallel review passes.

Use `database-agent` as a reviewer; `backend-agent` owns DB code. Keep `documentator-agent`, `quality-agent`, and `code-reviewer` after implementation converges unless their files are demonstrably disjoint.

## Spawn and task list

Spawn each teammate by its existing project agent type, e.g. “Spawn a teammate using the backend-agent agent type…”. Create a shared task for each deliverable, set dependencies explicitly, and include in every spawn/task prompt:

- originating task/spec and Acceptance criteria;
- exact owned files/globs and forbidden overlapping areas;
- relevant docs and contracts;
- verification command for that deliverable;
- who must be messaged when a contract or assumption changes.

Teammates may communicate directly, but a message does not authorize a Scope expansion or a product/architecture change. Such changes return to the lead.

## Register per-session Scope

Do not use the shared `.claude/.active-task-scope.json` during parallel team edits.

After teammates spawn, inspect Claude Code's generated runtime team config under `~/.claude/teams/<session-derived-name>/config.json`. Do not edit that runtime config. Read the actual session IDs/member mapping, then create one project-local file for the lead and every teammate:

```text
.claude/.active-task-scope.<session_id>.json
```

Each file uses the normal shape:

```json
{
  "taskFile": "docs/tasks/<task>.md#<team-deliverable>",
  "scope": ["owned/path/**", "owned/test/path/**"]
}
```

Use the full session ID sanitized to letters, digits, `_`, and `-`, matching `scope-guard.js`. Include only that session's owned paths. Register the lead too if it will edit. Once any session-scoped file exists, an unregistered session is intentionally blocked rather than inheriting another session's Scope.

## Coordination and completion

- Teammates claim only unblocked tasks and send contract changes directly to affected teammates and the lead.
- Wait for all implementation teammates; do not duplicate their work in the lead session.
- Resolve overlaps immediately by stopping one owner and reassigning the file explicitly.
- Run `documentator-agent`, `quality-agent`, and `code-reviewer` through the same focused repair loop as `/feature-loop`.
- A failing check returns to only the owning teammate/agent, then the targeted check and full suite rerun.
- Finish at Human Review. Shut down teammates gracefully when needed; current Claude Code cleans team runtime resources automatically when the session ends.

Remove stale `.claude/.active-task-scope.<session_id>.json` files after the team session. They are gitignored and must never be committed.
