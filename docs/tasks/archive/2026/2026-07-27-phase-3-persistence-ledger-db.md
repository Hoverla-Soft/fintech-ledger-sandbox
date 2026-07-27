# Task: Phase 3 — Ledger persistence (packages/db)

Run with `/feature-loop docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md` (or `/work-task …`) from a session rooted in this repo. The **Scope** section is enforced by the `PreToolUse` scope-guard hook.

## Goal

The persistence layer that makes the ledger's DB-enforced invariants real. `packages/core` (Phase 2) proved the invariants that hold in a pure domain; this phase proves the five that only a database can enforce — **#2 balances reconcile, #3 atomicity, #4 idempotency under concurrency, #5 no cross-tenant leakage, #8 immutable history** (`docs/product/requirements/ledger.md`).

`packages/db` knows nothing about HTTP. No oRPC, no Zod contracts, no React. It consumes `packages/core` through that package's public entry point only, and re-uses the domain's funds rule rather than restating it in SQL.

Deliver:

- **Tenancy foundation** — register Better Auth's **organization plugin** in `packages/auth`, producing the `organization`, `member`, and `invitation` tables plus the `session.activeOrganizationId` column. Every ledger table carries a real FK to `organization.id`. This closes a live docs↔code gap: `ledger.md`, `tech-stack.md`, and `architecture.md` all already assert the org plugin is the tenancy source of truth, but `packages/auth/src/index.ts` ships `plugins: []` and no org tables exist.
- **Ledger schema** — five Drizzle tables, `ledger_`-prefixed to avoid colliding with Better Auth's existing `account` table: `ledger_account`, `ledger_transaction`, `ledger_posting`, `ledger_idempotency_key`, `ledger_audit_entry`.
- **The atomic posting routine** — one public `postTransaction(...)` that takes a domain `Transaction` and commits it in a single Postgres transaction with ordered row locks, or commits nothing.
- **Read repositories** — org-scoped account/transaction/posting reads, cursor-paginated history, reconciliation verify, audit + rejection listing.
- **Integration test suite** — real Postgres via Testcontainers, covering each invariant plus the four `ledger.md` acceptance scenarios.
- **ADR 0003** (balance & concurrency strategy) and **ADR 0004** (idempotency), both already reserved in `docs/adr/README.md`.

## Status

Done

Completed 2026-07-27 via `/feature-loop`. Committed as `27a8f97` (47 files, +7375/-55).

**Verification at close** — `pnpm check-types` 0 (5/5 tasks, now including `packages/db`) · `pnpm test` 0 (**96 tests**: 68 unit in `packages/core`, 28 integration in `packages/db` against real Postgres via Testcontainers) · `pnpm build` 0 · `migration-integrity-guard --check` 0 · lint `N/A: no linter wired`.

The `packages/db` test task is `cache: false` in `turbo.json`, and the quality gate confirmed by polling `docker ps` mid-run that real `postgres:18` containers start, become healthy, and are reaped — so the integration suite cannot report a cached green without having run.

**Reviews:** architect (boundary decisions, all applied) · database-agent (1 blocking + 5 should-fix, all resolved) · quality-agent (all acceptance criteria evidenced) · code-reviewer (**no critical, no should-fix-now**).

### Deferred, non-blocking

| Item | Where |
|---|---|
| If the second-transaction rejection audit write itself fails, the original domain reason is lost in favor of the infra error. Inherent to the two-transaction design, documented in ADR 0003. | `posting/post-transaction.ts` |
| Test `unwrap` helpers use `JSON.stringify` on error values that may carry `bigint`, so a failing fixture surfaces a confusing serialization error instead of the real one. Test-only. | `test/fixtures.ts` |
| `architecture.md`'s data-flow diagram still implies the idempotency key is recorded at the end; the shipped routine reserves it first and backfills `transaction_id` later. Diagram-level simplification. | `docs/development/architecture.md` |
| `createDb`'s `pg.Pool` has no `statement_timeout` or pool-size cap. Changing it affects `packages/auth` too. | `packages/db/src/index.ts` |
| `listAccounts` has no upper bound, unlike `listTransactions`/`listAuditEntries` which clamp. | `repositories/accounts.ts` |

## Scope (allowed paths)

- `packages/db/src/**`
- `packages/db/drizzle/**`
- `packages/db/package.json`
- `packages/db/tsconfig.json`
- `packages/db/vitest.config.ts`
- `packages/db/drizzle.config.ts`
- `packages/auth/src/index.ts`
- `packages/auth/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `turbo.json`
- `docs/development/tech-stack.md`
- `docs/development/testing-rules.md`
- `docs/development/architecture.md`
- `docs/backend/data-model.md`
- `docs/test-coverage.md`
- `docs/adr/0003-balance-and-concurrency.md`
- `docs/adr/0004-idempotency.md`
- `docs/adr/README.md`
- `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`

Notes on why several non-obvious paths are included:

| Path | Why it is unavoidable |
|---|---|
| `packages/auth/src/index.ts` | The org plugin must be registered for `organization` to exist. Ledger FKs cannot target a table that no plugin creates. |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Adding `@testcontainers/postgresql` writes a catalog entry and rewrites the lockfile. |
| `turbo.json` | The `test` task needs Docker-dependent env passthrough and must not cache integration results keyed only on source hashes. |
| `docs/development/architecture.md` | Its data-flow section describes this routine; the posting/locking description must match what ships. |
| `docs/backend/data-model.md` | Still an unfilled `{{placeholder}}` template. Phase 3 creates the entities it is supposed to describe. |
| `packages/db/drizzle.config.ts` | Schema path may need to widen once `src/schema/` gains ledger + organization modules. |

Root `vitest.config.ts` is deliberately **not** in Scope: it globs `packages/*/vitest.config.ts`, so `packages/db` registers itself.

## Out of scope

- No `packages/api`, `apps/server`, or `apps/web` changes — endpoints, Zod contracts, and error→HTTP mapping are Phase 4.
- No **seed/reset endpoint** (`ledger.md` line 62 assigns it to the API phase). The four acceptance scenarios land in Phase 3 only as *test fixtures*, not as a shipped seeding surface.
- No permission/role enforcement. `member.role` is stored; deciding who may call what is Phase 4. Better Auth's org plugin defaults to `owner`/`admin`/`member` while `ledger.md` specifies `admin`/`viewer` — reconciling that mapping is Phase 4's problem, not a schema change here.
- No holds/authorizations, no FX — out of v1.
- Don't refactor `packages/core`. If a domain gap appears, stop and report it rather than editing across the boundary.

## Related docs

- `docs/product/requirements/ledger.md` — the invariants this phase enforces
- `docs/development/architecture.md#data-flow` — the write path this routine implements
- `docs/adr/0002-money-representation.md` — why balances are `bigint` minor units
- `docs/development/tech-stack.md` — Drizzle + Postgres; Testcontainers declared by this task

## External sources

Use stable IDs or links and identify the authoritative artifact.

- Task/issue: N/A: internal showcase, tracked in this repo's task files.
- Product documentation: N/A: local, `docs/product/requirements/ledger.md` is authoritative.
- Design: N/A: no UI in this phase.
- Library reference: Better Auth organization plugin schema verified against pinned `better-auth@1.6.23` (catalog) via context7, not assumed.

## Design

### Schema

All ledger tables carry `org_id` with an FK to `organization.id` and are indexed on it. Money columns are Drizzle `bigint(..., { mode: "bigint" })` so they round-trip as JS `bigint` and match `Money.minorUnits` with no lossy `number` hop.

| Table | Key columns | Notes |
|---|---|---|
| `ledger_account` | `org_id`, `name`, `currency`, `type` (`normal`\|`external`), `balance` bigint, `active` | Materialized balance. Unique `(org_id, name)`. |
| `ledger_transaction` | `org_id`, `currency`, `reverses_transaction_id` (self-FK, nullable), `created_by`, `created_at` | Index `(org_id, created_at, id)` for cursor pagination. |
| `ledger_posting` | `org_id`, `transaction_id`, `account_id`, `direction`, `amount` bigint (>0 CHECK), `currency` | Append-only. Index `(account_id, created_at)`. |
| `ledger_idempotency_key` | `org_id`, `key`, `request_hash`, `transaction_id` | **UNIQUE `(org_id, key)`** — this constraint *is* invariant #4. |
| `ledger_audit_entry` | `org_id`, `actor_user_id`, `action`, `outcome`, `reason`, `transaction_id` (nullable), `metadata` jsonb | One table, `outcome` discriminates posted vs. rejected; the "rejections" view is a filtered query, not a second table. |

Invariant #8 is enforced by a trigger on `ledger_posting` that raises on `UPDATE` and `DELETE`, so immutability is a database guarantee rather than a convention repositories are trusted to honour.

### Module layout

```
packages/db/src/
  schema/organization.ts       org plugin tables (organization, member, invitation)
  schema/ledger.ts             the five ledger tables, enums, relations
  posting/post-transaction.ts  the routine (the only public write path)
  posting/reserve-key.ts       idempotency reservation + replay detection
  posting/lock-accounts.ts     ordered SELECT … FOR UPDATE
  repositories/accounts.ts
  repositories/transactions.ts
  repositories/reconciliation.ts
  repositories/audit.ts
  errors.ts                    IdempotencyConflict, AccountNotFound, …
  test/setup.ts                Testcontainers bootstrap + migrate
```

The public surface stays narrow — callers hand over a validated `Transaction` and never see the lock choreography. `architecture.md` assigns "the atomic posting routine (transaction + row locks)" to `packages/db` precisely so `packages/api` cannot get lock ordering wrong.

### Approved boundary decisions (architect review, 2026-07-27)

Four decisions settled before implementation. The first reverses an earlier call in this task file.

**1. Narrow the `"./*"` wildcard export — now in scope, was previously deferred.** The original draft deferred this as a pre-existing nit. That was wrong: Phase 3 *creates* `posting/lock-accounts.ts`, `posting/reserve-key.ts`, and `test/setup.ts`, and under `"./*"` every one becomes independently importable from outside the package — directly contradicting this design's "callers never see the lock choreography" goal. `packages/api` in Phase 4 is the next consumer, and a too-wide surface would get baked into its imports permanently. `packages/db/package.json` is already in Scope, so this crosses no new boundary. Replacement map:

| Export | Target |
|---|---|
| `.` | `src/index.ts` — `createDb`, `db` |
| `./schema/auth` | `src/schema/auth.ts` — already consumed by `packages/auth` |
| `./schema/organization` | `src/schema/organization.ts` — new, consumed by `packages/auth` |
| `./posting` | `src/posting/index.ts` — barrel exporting **only** `postTransaction` |
| `./repositories` | `src/repositories/index.ts` — the four read surfaces |
| `./errors` | `src/errors.ts` |

Deliberately **not** exported: `schema/ledger.ts` (repositories and the posting routine are the only intended access path to ledger tables) and anything under `test/`.

**2. `errors.ts` must not redeclare `InsufficientFunds`.** It already exists in `packages/core` and is what `applyDelta` returns. `packages/db/src/errors.ts` defines only genuinely new *persistence* errors (`IdempotencyConflict`, `AccountNotFound`, immutability/cross-org errors); `postTransaction`'s result unions those with `core`'s re-exported `LedgerError`. Restating the domain error in the persistence layer is the same duplication this design rejects for the funds rule itself.

**3. `postTransaction` and every repository take an injected Drizzle instance.** `packages/db/src/index.ts` currently builds `export const db = createDb()` as a module-level singleton bound to `env.DATABASE_URL` at import time. Testcontainers allocates its connection URL dynamically, so tests must pass a `createDb()`-built instance explicitly rather than mutating env before import or reaching for the singleton. A one-line signature decision now; a retrofit across every file later.

**4. `packages/db` gains `@fintech-ledger-sandbox/core` as a runtime `dependency`** (not `devDependency` — `applyDelta`/`Transaction` are consumed at runtime). `core` has no dependencies, so this is a leaf edge and the graph stays acyclic. `architecture.md`'s dependency line and `packages/db` row are updated to state the `db → core` edge, which `core`'s own docstring already anticipates but the graph never recorded.

**Guardrail:** `schema/organization.ts` stays pure Drizzle with no `better-auth` import, and `packages/db` must never depend on `packages/auth` — `auth → db` already exists, so that would be the one genuine cycle available here.

### The posting routine

`postTransaction({ orgId, actorId, idempotencyKey, requestHash, transaction })` → `Result<PostedTransaction, …>`, inside **one** Postgres transaction:

1. **Reserve the idempotency key first** — a plain `INSERT`, deliberately **not** `ON CONFLICT DO NOTHING`. A concurrent duplicate then *blocks* on the unique index until the first committer finishes, and surfaces a unique violation it can convert into a replay. `ON CONFLICT DO NOTHING` returns zero rows without blocking, and under `READ COMMITTED` the loser cannot yet see the uncommitted row — so both callers would proceed and post twice. On violation: same `request_hash` ⇒ replay the original result; different ⇒ `IdempotencyConflict`.
2. **Lock accounts** — `SELECT … FOR UPDATE WHERE org_id = $1 AND id = ANY($2)` with ids **sorted**, so two transfers touching the same pair in opposite directions cannot deadlock. The `org_id` predicate is invariant #5: an account belonging to another org is simply not found, indistinguishable from a missing id, so nothing about another tenant leaks (`ledger.md` line 56).
3. **Apply deltas under the lock** — `transaction.deltas()` yields the net signed `Money` per account; each goes through `core.applyDelta(account, balance, delta)`. The funds rule lives in the domain and is *reused*, never restated in SQL.
4. Insert `ledger_transaction` → insert all `ledger_posting` rows → update each balance → backfill the idempotency row's `transaction_id` → write the audit entry → commit.

**Rejections need a second transaction.** `ledger.md` lines 54–55 require a failed transfer to be *recorded* while guaranteeing no postings are written. An audit row written inside the failing transaction rolls back with it, leaving the rejection log silently empty. So on failure the routine rolls back, then writes the rejection audit entry in its own transaction. This is the one place where "atomic" and "recorded" pull against each other, and the resolution is deliberate.

### Reconciliation

`SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END)` per account, compared against `ledger_account.balance`. The sign convention mirrors `core`'s `signedAmount` (debit positive, credit negative) — `posting.ts` documents that `packages/db` depends on it, and this query is that dependency.

## Acceptance criteria

- `organization`, `member`, `invitation` exist and `session.activeOrganizationId` is added; `packages/auth` registers the plugin; every ledger table FKs to `organization.id`.
- Migration generated into `packages/db/drizzle/` via `drizzle-kit generate` (never `db:push`), journal intact, and `node .claude/scripts/migration-integrity-guard.js --check` passes.
- **#2 reconciliation** — verify returns clean for every account across all four scenarios.
- **#3 atomicity** — a transfer that fails after the transaction row is inserted but before balances are updated leaves zero `ledger_posting` rows, zero `ledger_transaction` rows, and byte-identical balances. Asserted by injecting a failure at two specific points: after posting insert, and after the first balance update in a multi-account transfer.
- **Rejections survive rollback** — an insufficient-funds attempt writes exactly one `ledger_audit_entry` with `outcome = 'rejected'` and `reason = 'insufficient_funds'`, while writing zero postings and leaving balances unchanged. This is the acceptance test for the second-transaction design above; without it the rejection log would silently roll back with the failed attempt and the gap would go unnoticed.
- **#4 idempotency** — N concurrent posts with one key over real parallel connections yield exactly one transaction; same key + same payload replays; same key + different payload returns `IdempotencyConflict`.
- **#5 tenant isolation** — every read/write is org-scoped; an account id from org B is not found from org A, and the error is indistinguishable from a missing id.
- **#8 immutable history** — direct `UPDATE`/`DELETE` on `ledger_posting` raises; correction is only via a reversing transaction linked by `reverses_transaction_id`.
- **Sufficient funds under contention** — concurrent transfers draining one `normal` account never drive it negative; an `external` account may go negative.
- The four `ledger.md` scenarios pass as integration fixtures: payroll run, marketplace payout with fees, insufficient-funds rejection, reversal.
- Coverage recorded in `docs/test-coverage.md`; `docs/backend/data-model.md` populated (no `{{placeholders}}` left); ADRs 0003 and 0004 written and indexed.
- `docs/development/tech-stack.md` Testing row updated — it currently says integration testing against a real DB is "not yet wired (Phase 3+)".

## Verification

```bash
pnpm check-types
pnpm test
pnpm build
```

Lint is `N/A: no linter wired yet` (Biome/oxlint planned — do not claim lint passes until it exists). Integration tests require a running Docker daemon for Testcontainers; a failure to reach Docker must surface as a clear error, never as a silently skipped suite.

If a check fails, fix only the affected area, rerun that check first, then rerun the complete verification block before marking the task done.

## Risks / carry-forward

| Risk | Disposition |
|---|---|
| Migration 0001 **alters** the existing `session` table (adds `activeOrganizationId`), so it is not purely additive. | Expected. Nullable column, safe. Flagged because `migration-integrity-guard` watches this directory and 0000 is already applied. |
| Better Auth's org roles (`owner`/`admin`/`member`) do not match `ledger.md`'s `admin`/`viewer`. | **Phase 4** — role mapping is enforced at the API boundary; the schema stores a role string either way. |
| `docs/product/roles-and-permissions/` contains only `EXAMPLE.md` with unfilled `{{placeholders}}` — it never defines `admin`/`viewer`, even though `ledger.md` line 38 cites it as the authority for them. | **Phase 4 precondition**, surfaced here so it isn't discovered mid-implementation. Phase 3 stores `member.role` without interpreting it, so nothing here is blocked; Phase 4 must fill that doc *before* wiring permission checks, or it will be enforcing a matrix that no document defines. |
| `bigint` does not serialize to JSON. | **Phase 4** — already recorded as a Consequence in ADR 0002; amounts cross the API boundary as strings. |
| `packages/db/package.json` exposes a `"./*"` wildcard export, the same anti-pattern removed from `packages/core` in Phase 2. | **Resolved into scope** by the architect review — see Approved boundary decision 1. Phase 3 adds the internal files the wildcard would expose, so deferring it would defeat this phase's own encapsulation goal. |
| Testcontainers cold-start adds seconds to `pnpm test`. | Accepted; unit suites stay fast and separate. Revisit only if it becomes painful in CI. |

## Retention

Task files are working records. When this task reaches `Done`, `Cancelled`, or `Superseded`, move it from `docs/tasks/` to `docs/tasks/archive/2026/` unless the user explicitly keeps it active.

Before archiving, ensure the durable decisions (balance/concurrency strategy, idempotency reservation ordering, the rejection-recording exception) are captured in ADRs 0003/0004 and `docs/backend/data-model.md`, not only here.

## Spec completeness checklist

Copied from `docs/product/FEATURE-CHECKLIST.md`.

### Common
- [x] Actor(s) defined — org admin posts/reverses; system reconciles. Roles enforced in Phase 4.
- [x] Entry point defined — `postTransaction(...)` and the read repositories; no HTTP surface in this phase.
- [x] Preconditions described — an `organization` row and org-scoped `ledger_account` rows must exist; caller supplies an already-validated domain `Transaction`.
- [x] Happy path described — the numbered posting routine above.
- [x] Error paths described — insufficient funds, idempotency conflict, unknown/cross-org account, plus the rejection-recording exception.
- [x] Permissions considered — N/A this phase: tenant isolation is enforced structurally via `org_id` predicates; role checks are Phase 4.
- [x] Acceptance criteria written
- [x] Tests defined — per-invariant plus the four scenarios.
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: this phase adds no HTTP surface (Phase 4).
- [x] Validation described — domain invariants validated in `packages/core` before reaching persistence; DB adds CHECK/UNIQUE/FK/trigger constraints. Zod stays at the Phase 4 contract boundary.
- [x] Error responses defined — typed repository errors (`InsufficientFunds`, `IdempotencyConflict`, `AccountNotFound`); HTTP mapping is Phase 4.
- [x] Side effects listed — postings inserted, balances updated, idempotency key stored, audit entry written; nothing else.

### Frontend
- [ ] Loading state defined — N/A: no UI in this phase (Phase 5).
- [ ] Empty state defined — N/A: no UI in this phase (Phase 5).
- [ ] Error state defined — N/A: no UI in this phase (Phase 5).
- [ ] Navigation after each action defined — N/A: no UI in this phase (Phase 5).
- [ ] Feedback (toast/inline/modal) defined — N/A: no UI in this phase (Phase 5).

---

*Started 2026-07-27. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*
