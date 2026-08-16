# Task: Deliver the API hardening phase (close the ⚠️ honest gaps)

## Goal

`docs/showcase/` is client-facing material whose stated premise is that every gap is marked ⚠️ rather than omitted (`docs/showcase/README.md:3`, `security.md:3`). Four of those ⚠️ rows describe the same never-scheduled slice — "the API hardening phase" — which archived task files have been deferring since Phase 4b: **security headers, structured logging (pino), graceful shutdown, and `/ready`**.

Honest marking bought this project credit. Spending that credit indefinitely turns the ⚠️ from candour into a backlog nobody drains. The outcome wanted here is that those rows go from ⚠️ to ✅ **with a "Proven by" link that resolves to a real test**, and that the rows still genuinely open say something truer than they do today.

One item in the quoted line is not a gap at all: `docs/showcase/architecture.md:38` lists **error monitoring** as "declared but not yet delivered", while `docs/development/tech-stack.md:60` declares it explicitly `none` for this sandbox. Those cannot both be true. It is a deliberate `none`, and the line is corrected rather than implemented.

## Status

Human Review

## Scope (allowed paths)

- `apps/server/src/**`
- `apps/server/package.json`
- `apps/server/vitest.config.ts`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `packages/api/src/context.ts` — **added mid-task.** Graceful shutdown has to close the pool, and the pool is a module-local singleton in this file with no way out. Two exports added (`getDatabase`, `closeDatabasePool`), no behaviour changed for existing callers
- `docs/test-coverage.md`
- `apps/server/src/app.ts`, `apps/server/src/logger.ts`, `apps/server/src/app.test.ts` (new)
- `docs/showcase/architecture.md`
- `docs/showcase/security.md`
- `docs/showcase/engineering-playbook.md`
- `docs/development/tech-stack.md`
- `docs/backend/error-handling.md`
- `docs/open-questions.md`
- `docs/tasks/2026-08-16-api-hardening-phase.md`

## Out of scope

- **Error monitoring / APM.** `tech-stack.md` declares it `none`. Installing one would contradict the declared stack, which CLAUDE.md forbids. The *doc line* claiming it is undelivered gets corrected instead.
- **Rate-limit response headers and shared counters** (`security.md:20`). ADR 0007 records both as deliberate, with the multi-replica swap-in written down. Not a hardening gap — a documented design position.
- **The maker-checker hole (#25) and the `approvals.approve` race (#26).** Still awaiting a decision; unrelated to this slice.
- `docs/operations/runbook.md` placeholders (`security.md:23`) — a real gap, but it is ops content authored by whoever owns the on-call rotation, not something to invent here.
- `apps/web` — no console change is required by any of this.

## Related docs

- `docs/backend/error-handling.md` → verification checklist, items 146–148, which name exactly these deliverables
- `docs/development/tech-stack.md` → rows 39 (Logging), 42 (Security headers), and the Status block at 60
- `docs/showcase/security.md` → the ⚠️ rows this task converts, including their "Proven by" column
- `docs/adr/0007-rate-limiting.md` → why rate-limit headers stay out of scope

## External sources

- Task/issue: `N/A: no external tracker configured` — see `docs/development/work-systems.md`
- Product documentation: `N/A: all product docs are local, in docs/`
- Design: `N/A: no user-facing surface in this task`

## Happy path

1. **Security headers.** Register Hono's built-in `secureHeaders` (already-installed dependency — no new package). Resolve the CSP-vs-`/api-reference` conflict deliberately: the Scalar reference UI needs inline script/style, so CSP is scoped rather than applied blindly, and the scoping is written down.
2. **Structured logging.** Add `pino` — the one logger `tech-stack.md` already declares — with `redact` covering cookies, auth headers, and connection strings. Replace `console.error` in `logUnexpectedError`. Emit a correlation id per request.
3. **Liveness vs readiness.** Keep `/` as the cheap liveness probe it already is; add `/ready` that actually queries Postgres, so a health check cannot report green while the database is gone.
4. **Graceful shutdown.** SIGTERM/SIGINT stop accepting connections, drain in-flight requests, then close the pool. Plus `uncaughtException`/`unhandledRejection` handlers.
5. **Pool bounds — deliberately NOT done here.** They are not one of the ⚠️ rows this task exists to close, and the one bound that matters (`statement_timeout`) turns out to abort the idempotency reservation's *deliberate* block on a contended write. That needs its own decision on a money path, so it stays open as `docs/open-questions.md` #28 with the reasoning recorded. Only the pool *handle* is touched, so shutdown can close it.
6. **Prove it.** `apps/server` currently has no test suite at all. Add one — otherwise this slice ships exactly the way the ⚠️ rows criticise, and `security.md`'s "Proven by" column would have nothing to point at.
7. **Retire the markers.** Flip the converted ⚠️ rows to ✅ with real links; correct the stale ones (`pnpm lint`'s 26 diagnostics and the `apps/web` timing gap were both closed on 2026-08-16); correct the `error monitoring` line; and make the CI row say what is actually true.

## Acceptance criteria

- [x] Response headers include `X-Content-Type-Options`, frame protection, and referrer policy on API routes; `/api-reference` still renders
- [x] HSTS is not asserted over plain-HTTP local dev
- [x] `pino` emits JSON with a per-request correlation id; a test proves a session cookie / auth header / connection string is redacted
- [x] `/ready` returns non-200 when the database is unreachable; `/` stays dependency-free
- [x] SIGTERM drains in flight work and closes the pool; no unhandled rejection can kill the process silently
- [x] `apps/server` has a real test suite wired into `pnpm test`
- [x] Every ⚠️ row this task closes links to a test that exists; every ⚠️ row left open is accurate as written
- [x] `docs/backend/error-handling.md` checklist items 146–148 are updated to match reality

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
pnpm audit --audit-level=high
```

## Retention

Move to `docs/tasks/archive/2026/` at `Done`. Durable decisions land in `docs/showcase/security.md`, `docs/development/tech-stack.md`, and `docs/backend/error-handling.md` first.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — the deployed `apps/server` process and its platform supervisor (Railway sends SIGTERM); no end-user actor
- [x] Entry point defined — `apps/server/src/index.ts` process start, plus `GET /` and `GET /ready`
- [x] Preconditions described — full suite green before the slice; recorded in Verification
- [x] Happy path described — seven ordered steps above
- [x] Error paths described — `/ready` returns non-200 on an unreachable database; `logUnexpectedError` still suppresses expected 4xx; `uncaughtException`/`unhandledRejection` are logged rather than silently swallowed
- [x] Permissions considered — `N/A: no authorization surface changed`. `/` and `/ready` are deliberately unauthenticated probes and must leak no tenant data
- [x] Acceptance criteria written
- [x] Tests defined — a new `apps/server` suite covering headers, `/ready` failure, and log redaction
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `GET /` (liveness, unchanged) and `GET /ready` (readiness, new); no oRPC procedure added
- [x] Validation described — `N/A: neither probe takes input`
- [x] Error responses defined — `/ready` non-200 with a body naming no connection detail, per the "errors leak nothing" rule in `docs/backend/error-handling.md`
- [x] Side effects listed — one lightweight DB query per `/ready` call; a pool ceiling that every consumer of `createDb` inherits, including the Testcontainers suites

### Frontend
- [x] Loading state defined — `N/A: no UI changed`
- [x] Empty state defined — `N/A: no UI changed`
- [x] Error state defined — `N/A: no UI changed`
- [x] Navigation after each action defined — `N/A: no UI changed`
- [x] Feedback (toast/inline/modal) defined — `N/A: no UI changed`

---

*Started 2026-08-16. Follows `2026-08-16-close-recorded-gaps`, which closed the gaps that changed no behaviour; this one changes server behaviour and is therefore separate.*
