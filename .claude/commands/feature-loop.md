---
description: Orchestrate a feature from request/spec through scoped implementation, documentation, quality gates, focused fixes, and human review
argument-hint: <feature request or docs/tasks/*.md>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, ToolSearch
---

Run the complete feature engineering loop for $ARGUMENTS. Persist until the feature reaches human review or a concrete decision/blocker requires user input. Never bypass permissions, expand Scope silently, invent product requirements, or weaken a verification check.

You are the workflow orchestrator. Keep ownership and stage order clear; delegate focused work to specialist agents instead of duplicating their implementation or review responsibilities yourself.

## 1. Intake and specification

- If `$ARGUMENTS` points to broad source material containing multiple independent outcomes and no approved inventory/task selects one of them, stop and route the user to `/plan-features <sources>`. Do not implement a multi-feature corpus as one oversized feature.
- Read `docs/development/work-systems.md`. If tasks, product docs, or design live externally, use `ToolSearch` when needed and call the exact allowed MCP read tools recorded there before finalizing scope or acceptance criteria. Preserve stable IDs/links in the local task's External sources section. If the server/tool is not connected, permitted, authenticated, or readable, report the precise failure instead of guessing or silently falling back.
- If the task references an entry in `docs/product/FEATURE-INVENTORY.md`, confirm its stable ID, status, dependencies, source links, and delivery group before continuing. Do not silently start a blocked item or bypass an unfinished prerequisite.
- If `$ARGUMENTS` is a task path, read it and its Related docs. If it is a feature request, dispatch `product-analyst` to create/update the requirement and user flow with testable Acceptance criteria and the full feature checklist.
- Run `spec-completeness-guard`. Resolve genuine spec gaps before implementation; place unresolved choices in `docs/open-questions.md` and ask the user when the choice materially changes behavior.

## 2. Architecture and task plan

- Dispatch `architect` when the work crosses packages, introduces a package, changes data ownership, or adds a provider. Record the approved boundary decision before implementation.
- Dispatch `infrastructure-agent` when work changes CI/CD, containers, IaC/cloud resources, deployment, environment boundaries, secrets plumbing, networking, observability delivery, backups/recovery, or operations procedures. Resolve provider/topology/environment decisions in `docs/development/infrastructure.md` before implementation.
- Ensure a task exists from `docs/tasks/TEMPLATE.md` with narrow Scope, Out of scope, Related docs, Acceptance criteria, and Verification commands for typecheck, lint, tests, and build. Scope must include the intended implementation files, test files, `docs/test-coverage.md`, and any provider/architecture docs the task requires before scope enforcement is activated.
- Perform `/work-task`'s setup: write `.claude/.active-task-scope.json`, check docs against code, and state the implementation approach.

## 3. Implementation

- Read `docs/development/skills-and-plugins.md` for the affected paths. Apply only extensions marked verified whose framework major version, runtime/router assumptions, companions, and path mapping match the task. Invoke them through their recorded implementation, guard, or explicit-workflow mode; project instructions and approved architecture override generic recommendations. Missing optional extensions do not silently weaken required built-in guards.
- Dispatch only the agents needed by Scope: `backend-agent`, `frontend-agent`, and `integration-agent`. Independent, disjoint areas may run in parallel after contracts and boundaries are agreed.
- Use `database-agent` to review non-trivial schema, migration, tenant-isolation, or query-plan work; `backend-agent` owns the resulting code changes.
- Do not let parallel agents edit the same files. Shared contracts are established before parallel implementation begins.
- Honor every PostToolUse guard reminder and resolve findings in the affected area.

## 4. Integration and experience review

- For design-led work, compare against the authoritative design artifact declared in `docs/development/work-systems.md`, including the exact file/page/frame or component reference. Record intentional deviations.
- When frontend and backend meet, verify the real contract: validation, safe error envelope, auth/permissions, loading/empty/error/success states, cache invalidation, navigation, and request correlation.
- Dispatch `ui-ux-agent`, `security-agent`, and `performance-agent` when their trigger conditions apply. Send actionable findings only to the responsible implementation agent.
- Apply `infrastructure-guard` and dispatch `infrastructure-agent` for infrastructure/deployment changes; safe validation/plan/render checks are allowed, but remote apply/deploy/destroy and production operations require explicit authorization.

## 5. Tests and documentation

- Dispatch `qa-agent` to add tests derived from Acceptance criteria and documented edge cases and to update `docs/test-coverage.md`.
- Dispatch `documentator-agent` after implemented behavior and tests stabilize. It synchronizes only affected documentation and reports code/spec/doc drift; required docs must already be inside task Scope.

## 6. Quality gate

- Dispatch `quality-agent` to run typecheck, lint, tests, and build from the task's Verification block.

## 7. Focused repair loop

If any check or review fails:

1. Read the actual failure and identify the smallest affected layer and file set.
2. Dispatch only its responsible implementation agent; do not refactor unrelated code.
3. Keep the fix inside the active Scope. If Scope is insufficient, stop and explicitly update the task before editing.
4. Rerun the failed check first.
5. Once it passes, rerun the complete Verification block.
6. Repeat until all checks are green or a concrete external/user decision blocks progress. Do not impose an arbitrary retry count.

## 8. Final review

- Dispatch `code-reviewer` against the diff and originating task. Any critical or should-fix-now finding re-enters the focused repair loop.
- When checks and required reviews are green, summarize the implemented Acceptance criteria, tests/checks run, deferred non-blocking items, and remaining manual checks. Set the task status to `Human Review` when a task file is in scope. Stop at **Human Review → Merge**; do not merge unless explicitly asked.
- After the user confirms merge/done/cancelled/superseded, update the task status and move completed, cancelled, or superseded task files to `docs/tasks/archive/YYYY/` unless the user explicitly keeps them active. Do not archive before affected durable docs are synchronized.
