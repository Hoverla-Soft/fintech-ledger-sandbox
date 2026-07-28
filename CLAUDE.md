# fintech-ledger-sandbox — project constitution

This file is auto-loaded every session. Keep it thin — detail lives in `docs/`, this file only points to it.

## What this is

The reference implementation for HoverlaSoft's AI-first engineering standard: a payments-style, double-entry, multi-tenant **fintech ledger sandbox**. Fake money, real correctness — every transfer is a balanced set of postings, balances reconcile, transfers are idempotent, and no org can see another's data. Built to prove the standard works end-to-end on a hard domain.

Monorepo layout: pnpm workspaces + Turborepo, see `docs/development/architecture.md` for package boundaries, `docs/development/tech-stack.md` for the actual frameworks/libraries in use, and `docs/development/coding-rules.md` for conventions.

Consumed workspace packages resolve through public `package.json` `exports`. In this repo those exports point at TypeScript **source** (Better-T-Stack "internal packages" convention), transpiled by each consuming app's bundler — a documented divergence from the generic dist-build contract (see `docs/development/architecture.md` → "Workspace package build contract"). Consumers still import only through a package's public entry point, never by reaching into internal file paths; the dependency graph stays one-way and `packages/core` depends on no sibling.

External task, documentation, design, repository, and communication sources are declared in `docs/development/work-systems.md`. Read from the declared source of truth; do not assume a connector or silently substitute stale local context.

Optional skills/plugins and their audited framework/version/path compatibility are declared in `docs/development/skills-and-plugins.md`. Installed extensions never override this constitution or approved project architecture and stack choices.

Infrastructure, deployment, recovery, and operational ownership are declared in `docs/development/infrastructure.md` and `docs/operations/`. Infrastructure changes require safe validation and review; never infer permission to apply, deploy, destroy, rotate secrets, or operate production.

## Commands

- Install: `pnpm install`
- Lint: `pnpm lint` (Biome — lint + format check, one root-level pass over ~219 files) · `pnpm lint:fix` (apply safe fixes) · `pnpm format` (format only)
- Typecheck: `pnpm check-types`
- Test: `pnpm test` *(Vitest added with the domain core in Phase 2; e2e via Playwright later)*
- Build: `pnpm build`
- Dev: `pnpm dev` (web → http://localhost:3001, API → http://localhost:3000, OpenAPI ref → http://localhost:3000/api-reference)
- Database: `pnpm db:start` (Docker Postgres) · `pnpm db:generate` (create migration) · `pnpm db:migrate` (apply) · `pnpm db:studio`

## How work gets done here

1. Every non-trivial change starts as a task file in `docs/tasks/` (copy `docs/tasks/TEMPLATE.md`). It declares an explicit **Scope** — the paths this change is allowed to touch.
2. Run `/work-task docs/tasks/<file>.md` to start. A `PreToolUse` hook enforces the declared Scope automatically — edits outside it are blocked, not just discouraged. See `.claude/settings.json`.
3. If the task turns out to need files outside its Scope, or looks like it's becoming a larger refactor than planned: stop and say so, don't silently expand scope.
4. When you start a task and notice the code doesn't match what the task or `docs/*` describes, say what you found and propose 2-3 concrete options before picking one and coding — don't silently resolve the discrepancy your own way.
5. Relevant guard skills run automatically after edits in their area (see `.claude/settings.json` `PostToolUse` mapping) — `configuration-guard`, `backend-architecture-guard`, `backend-reliability-security-guard`, `frontend-component-structure-guard`, `frontend-fetch-guard`, `integration-spec-guard`, `db-architecture-guard`, `database-migration-guard`, `infrastructure-guard`, `spec-completeness-guard`. Migration/seed edits also trigger the blocking Drizzle journal integrity hook; run it directly with `node .claude/scripts/migration-integrity-guard.js --check` in CI.
6. No skill or agent in this template hardcodes a framework. If a task needs a library not yet declared in `docs/development/tech-stack.md`, fill that in first (ask if it's a genuinely open choice — see `docs/development/framework-companions.md`) before installing anything.
7. `/feature-loop <feature request or task path>` is the workflow orchestrator for the full spec-to-green-checks cycle. It delegates documentation synchronization to `documentator-agent`. A failed check returns only to the responsible implementation area, then affected docs, the failed check, and the full verification suite are updated/run again. Never make CI green by weakening a check.
8. When source material contains multiple possible features, run `/plan-features <sources>` first. It creates an evidence-backed inventory and separate drafts only after user approval; each approved item then enters its own `/feature-loop`.
9. Task files are working records, not permanent product documentation. Keep active/ready/in-progress tasks directly in `docs/tasks/`; move completed, cancelled, or superseded tasks to `docs/tasks/archive/YYYY/`; periodically compress old archived tasks into `docs/tasks/archive/YYYY/index.md` after durable decisions are captured in product, architecture, integration, testing, or operations docs.
10. Experimental Agent Teams are optional and disabled by default. When explicitly enabled, use `/team-feature-loop` and follow `TEAM-AGENTS.md`; every lead/teammate session gets its own `.claude/.active-task-scope.<session_id>.json`, and file ownership must not overlap.
11. Use `git worktree` for independent Claude sessions, benchmark runs, or parallel branches that should not share `.claude/.active-task-scope.json`, staged changes, or working files. Worktrees are session isolation around the workflow, not participants inside `/feature-loop` or `/team-feature-loop`.

## Don't

- Don't scan the whole repo for a task scoped to one package — search inside the declared Scope.
- Don't rewrite working code to make it "prettier" without being asked.
- Don't add a dependency or abstraction for one-time logic.
- Don't install or assume a framework/library that isn't declared in `docs/development/tech-stack.md`.
- Don't hand-roll behavior already owned by a declared, established dependency or shared utility. Inspect the target workspace manifest, lockfile, and nearby usage first; propose installing a declared missing package, and ask before changing dependencies.
- Don't run two ordinary `/work-task` sessions in the same checkout; use separate worktrees or an explicit Agent Teams run with per-session Scope.

## Reference

- `docs/development/tech-stack.md` — the actual frameworks/libraries this project uses; the source of truth every skill/agent reads instead of assuming
- `docs/development/framework-companions.md` — what to ask when a core framework is set but a companion choice (routing, state, etc.) isn't yet
- `docs/development/architecture.md` — package boundaries, provider abstraction model
- `docs/development/coding-rules.md` — code-level conventions (language, components, async, monorepo)
- `docs/development/testing-rules.md` — how we test, `docs/test-coverage.md` — what's covered
- `docs/development/work-systems.md` — external task/docs/design systems, MCP connectors, authority, access, and fallbacks
- `docs/development/skills-and-plugins.md` — audited optional extensions, compatibility, integration mode, verification, and rollback
- `docs/development/infrastructure.md` and `docs/operations/` — environments, CI/CD, IaC/runtime, deployment, rollback, recovery, and runbooks
- `docs/integrations/` — one file per external provider (endpoints, edge cases, webhooks)
- `docs/product/FEATURE-CHECKLIST.md` — completeness bar every feature spec must clear
- `docs/product/FEATURE-INVENTORY.md` — approved multi-feature decomposition, dependencies, delivery groups, and handoff links
- `docs/open-questions.md` — unresolved decisions and assumptions, don't silently assume — check here first
- `TEAM-AGENTS.md` — optional experimental Agent Teams setup, teammate reuse, per-session Scope, and parallel-work rules
