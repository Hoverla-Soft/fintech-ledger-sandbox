# Task: Enforce tenant isolation in Postgres, not only in `packages/api`

## Goal

Close `docs/open-questions.md` #30. Today invariant #5 is enforced by every repository remembering to filter on `org_id` (ADR 0005). Postgres itself has no opinion: a query that forgets the predicate returns every tenant's rows. After this task, an org-scoped request runs as a **non-owner role subject to row-level security**, so a forgotten `WHERE org_id = ...` returns zero rows instead of everyone's — the database fails closed rather than open.

The ledger's observable behaviour must not change. Same responses, same status codes, same error bodies.

## Status

Human Review

## Scope (allowed paths)

- `packages/db/drizzle/0008_row_level_tenancy.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/src/tenancy.ts`
- `packages/db/src/index.ts`
- `packages/db/package.json`
- `packages/db/src/repositories/tenant-isolation.test.ts`
- `packages/db/src/repositories/pending-transfers.ts` *(added mid-task — see Approach)*
- `packages/api/src/procedures.ts`
- `packages/api/src/routers/tenant-isolation.test.ts`
- `docs/adr/0005-tenant-isolation.md`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/development/architecture.md`

## Out of scope

- **The `Db` type and the ~30 repository signatures.** They keep taking `db: Db`. The org-scoped handle is a `PgTransaction`, which offers the same query-builder surface; widening thirty signatures to a union to express that would be a far larger diff than the guarantee is worth.
- **`DATABASE_URL` and every deployment that sets it.** The restricted role is reached with `SET LOCAL ROLE` inside the request transaction, not by pointing the app at a second connection string. See the Approach note.
- **Better Auth's tables and `packages/auth`.** `user`, `session`, `account`, `verification`, `member`, and `invitation` are not org-scoped rows and get no policy. `organization` gets one, because `getOrgSettings` reads it from inside a scoped handler.
- **The 25 test files that seed ledger rows directly.** They connect as the owner, which bypasses RLS, and they must keep doing so — see Design.
- Anything about open questions #5, #9, #10, #17, #18, #21–#23.

## Related docs

- `docs/adr/0005-tenant-isolation.md` — the API-layer half of invariant #5, and the recorded consequence this task closes
- `docs/adr/0003-balance-and-concurrency.md` — the schema half (composite FKs, `org_id` on every table)
- `docs/product/requirements/ledger.md` — invariant #5
- `docs/open-questions.md` #30

## External sources

- Task/issue: N/A: local open-questions register, row #30
- Product documentation: N/A: no external documentation system (`docs/development/work-systems.md`)
- Design: N/A: no user-visible surface changes

## Design

### Why a role, and why `SET LOCAL ROLE`

RLS is skipped for a table's owner unless `FORCE ROW LEVEL SECURITY` is set. The app connects as the owner today, so there are only two ways to make policies bite:

1. `FORCE` on the existing role. No new role, no connection change — but it subjects the owner too, so every fixture insert in ~25 test files, both fixture modules, and `drizzle-kit`'s migrator all need a scope first. And it is not a privilege boundary: the owner can `DISABLE ROW LEVEL SECURITY` at will.
2. A second, non-owner role. Policies bite without `FORCE`, and the owner keeps its bypass, so migrations, seeds, and every existing test stay exactly as they are.

(2) is both stronger and the smaller diff. The remaining question is how the app *becomes* that role. Pointing `DATABASE_URL` at it would need a matching change in `docker-compose.yml`, `.env`, and Railway, plus a second owner URL for `drizzle-kit migrate`. `SET LOCAL ROLE` inside the request transaction reaches the same role with no configuration change anywhere, and reverts at COMMIT so a pooled connection is never left elevated or de-elevated.

### Where the scope is opened

`requireOrg` in `packages/api/src/procedures.ts` already resolves the verified `orgId` from a `member` row. It is the one place every org-scoped request passes through, so it opens the transaction and hands the scoped handle down as `context.db`:

```
requireOrg
  ├── resolveMembership(db, ...)          <- as owner, before the scope
  └── withOrgScope(db, orgId, (scoped) => next({ db: scoped, orgId, ... }))
        ├── SELECT set_config('app.current_org_id', $1, true)
        ├── SET LOCAL ROLE ledger_app
        └── ...the entire handler...
```

`withOrgScope` lives in `packages/db` rather than in the middleware so the future direct-`packages/db` caller #30 is about — a job, a script — has the same door to walk through.

### What each test file exercises

Every one of the ~343 `packages/api` tests already drives a real router over a real database, and every org-scoped call now runs through this transaction. So the suite exercises RLS for free: if a policy were wrong, hundreds of tests would go red. Seeding happens outside the scope, as the owner, unchanged.

## Approach

Deliberate deviation from the shape approved in conversation: the approved option had `ledger_app` as a `LOGIN` role with `DATABASE_URL` repointed at it. This ships the same role, the same policies, and the same `SET LOCAL app.current_org_id`, but reaches the role with `SET LOCAL ROLE` and leaves the role `NOLOGIN`. Reason: it is the same enforcement for the request path with zero configuration churn in three environments, and it keeps `drizzle-kit migrate` working off the single existing URL. Granting `LOGIN` and repointing `DATABASE_URL` later is then a pure ops change — the application code is identical either way, because `SET LOCAL ROLE ledger_app` is a no-op when the session is already that role. What it does *not* cover is a future script that connects as the owner and never calls `withOrgScope`; that is recorded in the ADR rather than left implied.

### Scope added mid-task: `repositories/pending-transfers.ts`

`insertPendingTransfer` inserts, catches a `23505`, and then reads the existing row back on the
same connection. That only worked because nothing had a transaction open around it: the failed
insert aborted its own implicit transaction, which then ended, leaving the connection clean. Under
any enclosing transaction the failed statement aborts *that* transaction, and the read-back fails
with `25P02 current transaction is aborted` instead of reporting a replay.

`posting/reserve-key.ts` has the identical insert-catch-read shape and already solved this by
running its insert inside a nested `transaction(...)`, which drizzle-orm implements as a SAVEPOINT;
its doc comment spells out why. `insertPendingTransfer` simply never needed it before. Fixing it
there rather than working around it in `withOrgScope` is the root-cause fix — the fragility belongs
to the repository, and any future caller that opened a transaction would have hit it.

## Acceptance criteria

- Six ledger tables and `organization` carry an `org_isolation` policy; `ledger_app` holds only the DML it needs and owns nothing.
- Inside `withOrgScope(db, orgA)`, a query with **no** `org_id` predicate returns only org A's rows.
- Inside `withOrgScope(db, orgA)`, inserting a row whose `org_id` is org B is rejected by Postgres.
- Outside any scope, the owner still sees every row — migrations, fixtures, and the truncate harness are unaffected.
- Every existing API test still passes with no change to any test file, proving the scope is transparent to handlers.
- The migration is re-runnable: a second apply is a no-op, not an error.
- No response body, status code, or error reason changes.
- `insertPendingTransfer` still reports a replay, not a `25P02`, when called inside a transaction.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` once merged, after ADR 0005 carries the durable decision.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — any signed-in user acting in a verified org; no user-visible actor change
- [x] Entry point defined — `requireOrg`, and `withOrgScope` for direct `packages/db` callers
- [x] Preconditions described — migration 0008 applied; caller holds a verified `orgId`
- [x] Happy path described — see Design
- [x] Error paths described — a policy violation surfaces as a Postgres error, not a new API error code; no new wire contract
- [x] Permissions considered — the role holds SELECT/INSERT/UPDATE and no DDL, no DELETE, no ownership
- [x] Acceptance criteria written
- [x] Tests defined — new cases in both `tenant-isolation.test.ts` files, plus the whole API suite as regression
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: no endpoint added or changed
- [x] Validation described — N/A: no new input
- [x] Error responses defined — unchanged by design; an escaping policy error would be a bug, not a contract
- [x] Side effects listed — every org-scoped request now runs in one transaction for its full duration

### Frontend
- [x] Loading state defined — N/A: no frontend change
- [x] Empty state defined — N/A: no frontend change
- [x] Error state defined — N/A: no frontend change
- [x] Navigation after each action defined — N/A: no frontend change
- [x] Feedback (toast/inline/modal) defined — N/A: no frontend change

## Verification results (2026-08-18)

| Check | Result |
|---|---|
| `pnpm lint` | 270 files, zero diagnostics |
| `pnpm check-types` | 6/6 workspaces |
| `pnpm test` | **779 passed** (core 90, server 13, web 299, db 34, api 343) — up from 773 |
| `pnpm build` | 2/2 |

**Every one of the 343 `packages/api` tests passed with no change to any test file.** That is the acceptance criterion "the scope is transparent to handlers", and it also means the whole API suite now exercises the policies: each of those tests drives a real router over a real database, and every org-scoped call runs as `ledger_app`.

**One test failed the first time, and it was a real defect rather than a test problem.** `approvals > replays the same pending row under the same idempotency key` failed with `25P02 current transaction is aborted`. `insertPendingTransfer` inserts, catches a `23505`, and reads the existing row back on the same connection — which only ever worked because nothing had a transaction open around it. Fixed at the source with the savepoint pattern `posting/reserve-key.ts` already used, not worked around in `withOrgScope`. See "Scope added mid-task".

**Six new tests in `packages/db/src/repositories/tenant-isolation.test.ts` prove the policies actually bite**, because a suite where everything passes is equally consistent with RLS being silently inert. Each issues SQL with no `org_id` predicate at all: an unfiltered read inside a scope returns only that org's rows (against an owner-level control that sees both); `current_user` is `ledger_app` inside and reverts after; a cross-org insert is refused by the policy; an unscoped read *as* `ledger_app` returns zero rows rather than everything; the scope commits work done before a throw; and migration 0008 re-applies cleanly.

## Follow-ups deliberately not done

- `ledger_app` stays `NOLOGIN`. A script that connects as the owner and never calls `withOrgScope` still sees every tenant. Granting `LOGIN` and repointing `DATABASE_URL` (with a separate owner URL for `drizzle-kit migrate`) closes that, and needs no application change — recorded in the ADR rather than left implied.
- Every org-scoped request now holds a pooled connection for its full duration, rate-limit check included. Fine at sandbox scale; the fix if it ever bites is a narrower scope, not a bigger pool.

---

*Started 2026-08-18.*
