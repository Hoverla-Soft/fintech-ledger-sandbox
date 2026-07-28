# Task: Phase 4a — API foundation + read surface (oRPC)

## Goal

`packages/api` stops being Better-T-Stack scaffolding and becomes the ledger's typed API boundary: a request arrives, its acting organization is **derived from a verified `member` row** (never from anything the caller sent), and the seven read procedures return org-scoped ledger data with amounts encoded as decimal strings. A caller authenticated into org A cannot read, enumerate, or infer the existence of org B's data through any procedure — proven by tests against a real Postgres, not by inspection.

This is the first of three Phase 4 slices. It deliberately ships **no write endpoints** (4b) and **no seed/reset** (4c), but it does establish the four things both of those depend on: the tenancy middleware, the role model, the wire contracts, and the error map.

## Status

Done

Human review completed and shipped in commit `dd17988` ("feat(api): enhance API boundary with tenant isolation and error handling").

Verified 2026-07-27: `check-types` 6/6, `test` 204 passed (68 core + 108 api + 28 db), `build` 2/2, migration integrity guard PASS. Lint is `N/A` — no linter is wired in this repo yet.

Allowed values: `Draft`, `Ready`, `In Progress`, `Human Review`, `Done`, `Cancelled`, `Superseded`.

## Scope (allowed paths)

**Implementation — `packages/api` (the bulk of the work):**

- `packages/api/src/**`
- `packages/api/package.json`
- `packages/api/tsconfig.json`
- `packages/api/vitest.config.ts`

**Wiring — `apps/server`:**

- `apps/server/src/index.ts`

**Build orchestration (added mid-task 2026-07-27, see "Scope expansions" below):**

- `turbo.json`

**`packages/db` — the curated test export, plus the timestamp-precision fix (see "Scope expansions"):**

- `packages/db/package.json`
- `packages/db/src/test/setup.ts`
- `packages/db/src/schema/ledger.ts`
- `packages/db/drizzle/**`
- `packages/db/drizzle.config.ts`

**Documentation that must stay synchronized:**

- `docs/product/roles-and-permissions/ledger.md`
- `docs/adr/0005-tenant-isolation.md`
- `docs/adr/README.md`
- `docs/backend/api-flow.md`
- `docs/backend/error-handling.md`
- `docs/development/tech-stack.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-07-27-phase-4a-api-foundation-reads.md`

## Out of scope

- **All write endpoints** — `accounts.create`, `transactions.create`, `transactions.reverse`. Phase 4b. `postTransaction` is not called anywhere in this task.
- **Rate limiting.** `ledger.md` line 66 scopes it to write endpoints; there are none here. Phase 4b, together with the `tech-stack.md` row declaring the library.
- **Seed/reset.** Nothing exists in `packages/db` for it. Phase 4c.
- **`packages/auth`.** The role decision below is a mapping at the API boundary; Better Auth's config is untouched and no migration of `member.role` happens.
- **`packages/core`.** No changes needed — `Money.format()`/`Money.parse()` already round-trip, which is exactly the wire codec this task requires.
- **`packages/db` schema, migrations, repositories, `drizzle/`.** Only the two files listed in Scope are touched, and only to publish the existing test harness. No SQL, no new query.
- **`apps/web`.** Phase 5.
- **`LedgerAccountRow.balance: bigint` vs `LedgerPostingRow.amount: Money`.** A real inconsistency in `packages/db`'s read surface, absorbed by the API mapper here. Do not "fix while you're in there" — changing a repository return type is a `packages/db` decision that belongs in its own task.

## Related docs

- `docs/product/requirements/ledger.md` — §Permissions, §Backend (API — Phase 4), §Error paths
- `docs/adr/0002-money-representation.md` — the `bigint` → string obligation this task discharges
- `docs/adr/0003-balance-and-concurrency.md` — the Phase 3 schema foundation ADR 0005 builds on
- `docs/development/architecture.md` — package boundaries
- `docs/tasks/archive/2026/2026-07-27-phase-3-persistence-ledger-db.md` — the deferrals this task collects

## External sources

- Task/issue: N/A: local phase plan, tracked in this repo's `docs/tasks/`.
- Product documentation: `docs/product/requirements/ledger.md` (repo-local source of truth).
- Design: N/A: no UI in this phase.

Library behavior verified against oRPC's own documentation during design (`COMMON_ERROR_STATUS_MAP`): `UNAUTHORIZED`→401, `FORBIDDEN`→403, `NOT_FOUND`→404, `CONFLICT`→409, `UNPROCESSABLE_CONTENT`→422. No custom `status` override is needed on any error this task defines.

## Approved boundary decisions

Recorded here because each one was a genuine fork during design, and a future reader will otherwise re-litigate it.

**1. The acting org is derived, never accepted.** No procedure input schema in `packages/api` may contain an `orgId`/`organizationId` field. `orgProcedure` resolves it from `session.activeOrganizationId` and then *verifies* it by loading the `member` row for `(activeOrganizationId, session.user.id)`. A forged or stale `activeOrganizationId` therefore fails membership and yields `403` — it cannot be used to address another tenant. This is the whole content of ADR 0005 and is enforced by a test that asserts no input schema exposes an org field.

**2. Roles map at the API boundary.** Better Auth's organization plugin issues `owner`/`admin`/`member`; `ledger.md` §Permissions specifies `admin`/`viewer`. A pure function translates: `owner`→`admin`, `admin`→`admin`, everything else (including an unrecognized string) →`viewer`. Fails closed. Rejected alternatives: reconfiguring the plugin with `createAccessControl` (touches `packages/auth` and needs a data migration for existing `member.role` values), and rewriting `ledger.md` to adopt the library's vocabulary (the spec is the durable source of truth; it does not bend to the library). This also matches what the Phase 3 task already recorded: *"role mapping is enforced at the API boundary; the schema stores a role string either way."*

**3. One `pg.Pool` per process.** `packages/db` deliberately exposes no `db` singleton (see the long comment in `packages/db/src/index.ts` explaining why the lazy-`Proxy` approach was rejected), so `packages/api` owns exactly one module-scope `createDb()` and injects it through the context. Building a `Db` inside `createContext` would open a fresh connection pool per HTTP request.

**4. `packages/db` gains a curated `./testing` export.** Phase 4a is the first moment a second package needs a migrated test database. `src/test/setup.ts` currently documents itself as internal because `packages/db` was the only consumer — a fact this task changes. Reaching in via a relative `../../db/src/test/setup` is forbidden by CLAUDE.md, and duplicating the harness would fork the `ALL_TABLES` truncate list, the Postgres image version, the migrations path, and the immutability-trigger workaround across two packages that must not drift. So: one deliberate subpath export, `"./testing": "./src/test/setup.ts"`. This is **not** a reversal of Phase 3's narrowing — that removed a `"./*"` wildcard which was exposing `posting/lock-accounts.ts` and `posting/reserve-key.ts` as independently callable internals. A named, intentional test-support entry point is a different thing. `setup.ts`'s header comment must be updated to state the new contract rather than left contradicting the export map.

**5. The full error map lands here, not half of it.** Reads only produce `404`. But `docs/backend/error-handling.md` is a 4a deliverable and has to document the complete table, and `toORPCError` is a pure function over a closed union — writing half now and reopening the doc in 4b costs more than finishing it. The `409`/`422` branches are unit-tested in this task and get wired to live endpoints in 4b.

## Scope expansions

Recorded rather than made silently, per CLAUDE.md rule 3.

**`packages/db` timestamp precision (2026-07-27, during implementation).** `transactions.list` returned a **duplicate row at every page boundary**, found by this phase's own multi-page pagination test. Root cause, confirmed empirically against the container rather than reasoned about: Postgres stores `timestamp` at microsecond precision (`21:14:05.884495`), Drizzle hands JavaScript a `Date`, and `Date` holds only milliseconds (`21:14:05.884`). The cursor therefore sends back a value strictly *smaller* than the row it points at, so `created_at > cursor` matches that same row again — the last row of each page reappears as the first row of the next.

The precision loss happens inside `packages/db`, before the API layer sees anything, so it affects every consumer of `listTransactions` and not just this phase. Fixing it at the cursor alone would have repaired pagination while leaving the same `Date`-vs-`timestamp` mismatch waiting for the next comparison anyone writes; setting the column precision to milliseconds makes storage and language agree exactly, and the existing comparison becomes correct as written. `transactions.list` is one of this task's seven endpoints and cursor pagination is a stated acceptance criterion, so shipping around it was not an option. Scope additions: `packages/db/src/schema/ledger.ts` and a new roll-forward migration under `packages/db/drizzle/`.

**`packages/db/drizzle.config.ts` (2026-07-27, during implementation).** Generating the migration above failed: `pnpm db:generate` has been broken since Phase 3. `drizzle.config.ts` points `schema` at the `./src/schema` **directory**, so drizzle-kit loads every `.ts` in it — including `ledger-immutability.test.ts`, which Phase 3 added and which imports `vitest`. drizzle-kit's CommonJS transformer cannot `require()` Vitest, so the command dies before reading any schema. Pointing `schema` at the existing barrel (`./src/schema/index.ts`, which already re-exports all three schema modules) loads exactly the same tables and excludes test files. One line; it repairs a documented command in `CLAUDE.md` and the migration workflow `tech-stack.md` declares as the migration of record. Hand-writing the migration and its journal entry instead would have meant hand-editing the snapshot metadata `migration-integrity-guard` exists to police.

**`turbo.json` (2026-07-27, during implementation).** `packages/db` carries a dedicated `@fintech-ledger-sandbox/db#test` task with `cache: false`, because a Testcontainers suite is not a pure function of its source inputs — Docker availability and applied migrations are environmental, so a cached "pass" can be replayed for a run that never started a container. `packages/api`'s integration tests are Testcontainers-backed for exactly the same reason, so they need the same treatment. Leaving the repo's two integration suites configured differently would be an unexplained trap for whoever next wonders why one caches and the other doesn't. Addition is one task entry; no existing task is modified.

## Design

### Layering

```
HTTP /rpc/*  ·  Hono (apps/server)
  └─ RPCHandler + OpenAPIHandler
      └─ createContext          → { db, session }
          └─ orgProcedure       → { db, orgId, actorId, role }   ← ADR 0005 enforcement point
              └─ routers/*      → packages/db repositories (org-scoped)
                                → packages/core (Money)
```

`packages/api` adds a dependency on `@fintech-ledger-sandbox/core`. Direction stays one-way; `core` still depends on no sibling.

### Tenancy middleware

`orgProcedure`, in order:

| Check | Failure |
|---|---|
| `session.user` exists | `UNAUTHORIZED` 401 |
| `session.activeOrganizationId` is set | `FORBIDDEN` 403, reason `no_active_organization` |
| `member` row exists for `(activeOrganizationId, user.id)` | `FORBIDDEN` 403, reason `not_a_member` |

One query returns both the verified `orgId` and the role string to map. `adminProcedure = orgProcedure` + `role === "admin"` is defined here so 4b has it, and is exercised by a unit test even though no read endpoint uses it.

### Wire contracts

**Money** — `{ amount: "12.34", currency: "USD" }`. Encode with `Money.format()`, decode with `Money.parse()`; the two are documented inverses. Never a JSON number, never a raw `bigint` (ADR 0002). Input schemas bound the decimal string's length before it reaches `BigInt`, closing the Phase 2 deferral about `BigInt` parsing being superlinear in digit count.

**Cursor** — `packages/db`'s `{createdAt, id}` is encoded as an opaque base64url string, so the `(created_at, id)` tiebreaker stays an implementation detail callers cannot construct against. A malformed cursor is `BAD_REQUEST` 400, not an unhandled 500.

### Error map (`packages/api/src/errors.ts`)

| Domain / persistence error | oRPC code | Status | `reason` |
|---|---|---|---|
| `AccountNotFound` | `NOT_FOUND` | 404 | `account_not_found` |
| `TransactionNotFound` | `NOT_FOUND` | 404 | `transaction_not_found` |
| `IdempotencyConflict` | `CONFLICT` | 409 | `idempotency_conflict` |
| `InsufficientFunds` | `UNPROCESSABLE_CONTENT` | 422 | `insufficient_funds` |
| `CurrencyMismatch` | `UNPROCESSABLE_CONTENT` | 422 | `currency_mismatch` |
| `UnsupportedCurrency` | `UNPROCESSABLE_CONTENT` | 422 | `unsupported_currency` |
| `InvalidAmount` | `UNPROCESSABLE_CONTENT` | 422 | `invalid_amount` |
| `NonPositiveAmount` | `UNPROCESSABLE_CONTENT` | 422 | `non_positive_amount` |
| `TooFewPostings` | `UNPROCESSABLE_CONTENT` | 422 | `too_few_postings` |
| `UnbalancedTransaction` | `UNPROCESSABLE_CONTENT` | 422 | `unbalanced_transaction` |

Cross-org and genuinely-missing both produce `404` and are indistinguishable, per `ledger.md` line 56 and the deliberate design of `packages/db/src/errors.ts`. `403` is reserved for *role/membership* denial, never for resource addressing — a `403` must never be the signal that a resource exists in another tenant.

**Error envelope.** oRPC's own serialization, unmodified: `{ "code": "NOT_FOUND", "status": 404, "message": "...", "data": { "reason": "account_not_found" } }`. `message` is a fixed human-readable string per branch — never an interpolated database error, never the offending id echoed back. `data.reason` is the stable machine-readable contract the console (Phase 5) will switch on.

### Happy path

Every read procedure follows the same sequence; `accounts.list` shown concretely.

1. Client sends `POST /rpc/accounts/list` with the session cookie.
2. Hono passes the request to `RPCHandler`, which builds the context: the single process-wide `db` plus the Better Auth session resolved from the cookie.
3. `orgProcedure`'s middleware runs the three checks above, loading the `member` row for `(session.activeOrganizationId, session.user.id)`. It yields `{ db, orgId, actorId, role }` — `orgId` taken from the verified row.
4. Zod parses the procedure input. For `accounts.list` the input is empty; for paginated procedures it validates `limit` and decodes the opaque cursor.
5. The handler calls the matching `packages/db` repository, passing `orgId` from context. Every repository query filters on it.
6. Rows are mapped to the wire shape — `bigint` minor units become decimal strings via `Money.format()`, `Date` becomes ISO-8601, the `{createdAt, id}` cursor becomes an opaque token.
7. The handler returns; oRPC serializes `200` with the typed payload.

A failure at step 3 returns 401/403 before any query runs. A `Result`-returning repository at step 5 that comes back `!ok` is passed to `toORPCError` and thrown, producing `404`.

### Read procedures

RPC path is `/rpc/<namespace>/<procedure>`, `POST` in all cases (oRPC's RPC protocol); the same procedures are also reachable as REST-shaped operations through the OpenAPI handler at `/api-reference`. **No input schema below contains an org field** — that is decision #1, and it is asserted by test.

| Procedure | Input | Output | Repository |
|---|---|---|---|
| `accounts.list` | *(none)* | `{ accounts: Account[] }` | `listAccounts` |
| `accounts.get` | `{ accountId: string(uuid) }` | `Account` | `getAccountById` |
| `transactions.list` | `{ limit?: int 1–200, cursor?: string }` | `{ transactions: Transaction[], nextCursor: string \| null }` | `listTransactions` |
| `transactions.get` | `{ transactionId: string(uuid) }` | `Transaction & { postings: Posting[] }` | `getTransactionById` |
| `reconciliation.verify` | *(none)* | `{ accounts: Reconciliation[], allReconciled: boolean }` | `reconcileAccounts` |
| `audit.list` | `{ limit?: int 1–200 }` | `{ entries: AuditEntry[] }` | `listAuditEntries` |
| `audit.rejections` | `{ limit?: int 1–200 }` | `{ entries: AuditEntry[] }` | `listRejections` |

Wire shapes (all timestamps ISO-8601 strings, all amounts decimal strings):

```jsonc
Account        { id, name, currency: "USD", type: "normal"|"external",
                 balance: { amount: "12.34", currency: "USD" },
                 active: boolean, createdAt }
Posting        { id, accountId, direction: "debit"|"credit",
                 amount: { amount: "12.34", currency: "USD" }, createdAt }
Transaction    { id, currency, reversesTransactionId: string|null,
                 createdBy, createdAt }
Reconciliation { accountId, accountName,
                 recordedBalance: Money, computedBalance: Money,
                 reconciled: boolean }
AuditEntry     { id, actorUserId, action, outcome: "posted"|"rejected",
                 reason: string|null, transactionId: string|null,
                 metadata: unknown, createdAt }
```

`orgId` is stripped from every output shape — it is a fact about the caller, not data worth echoing. `reconciliation.verify` adds a derived `allReconciled` so a caller doesn't have to fold the array itself to answer invariant #2.

`healthCheck` stays public. The scaffolded `privateData` procedure **stays too**, unchanged — `apps/web/src/routes/_auth/dashboard.tsx` consumes it, and `apps/web` is out of Scope for this phase, so deleting it here would break `check-types` and `build` with no in-Scope way to fix the consumer. It returns only the caller's own session user and no org-scoped data, so leaving it costs nothing. Phase 5 removes it when the console is rebuilt against the real read endpoints.

## Acceptance criteria

- All seven read procedures exist, are org-scoped, and return amounts as decimal strings with an explicit currency — no `bigint` and no JSON number reaches the wire.
- `accounts.get` and `transactions.get` return `404` for a cross-org id, identical in code, `reason`, and body to a genuinely missing id.
- A request with no session gets `401`; with a session but no active org, `403`; with an `activeOrganizationId` the user has no `member` row for, `403`.
- No procedure input schema anywhere in `packages/api` accepts an `orgId`/`organizationId`. Asserted by a test, not by review.
- No procedure *output* contains `orgId` either — the repositories return it on every row and the mappers must drop it.
- `toLedgerRole` maps `owner`/`admin`→`admin` and every other value, including unknown strings, →`viewer`.
- `toORPCError` covers all ten error kinds in the table above with the documented status and stable `reason`; exhaustiveness is enforced by the type checker over the closed union.
- Cross-tenant tests: with orgs A and B both seeded with data, every one of the seven procedures called as A returns only A's rows and never reveals B's existence.
- A thin `app.fetch()` slice confirms 401/403/404 reach the wire with those actual HTTP statuses — not just the right `ORPCError` in-process.
- `packages/db` exposes `./testing`; `packages/api` imports the harness through it and through no relative path.
- `docs/product/roles-and-permissions/ledger.md` is filled in with real roles, a real permission matrix, and a real enforcement statement — no `{{placeholders}}` remain.
- ADR 0005 is written and indexed in `docs/adr/README.md`; `docs/backend/api-flow.md` and `docs/backend/error-handling.md` have no `{{placeholders}}` left.
- `docs/test-coverage.md` and `docs/development/tech-stack.md` reflect what actually shipped.

## Verification

```bash
# N/A: no linter is wired in this repo yet (Biome/oxlint planned) — see CLAUDE.md
pnpm check-types
pnpm test
pnpm build
```

Requires a reachable Docker daemon for the Testcontainers-backed suites. If a check fails, fix only the affected area, rerun that check first, then rerun the complete block before marking the task done.

## Retention

Task files are working records. When this task reaches `Done`, move it to `docs/tasks/archive/2026/`, after confirming its durable decisions live in ADR 0005, `docs/backend/api-flow.md`, `docs/backend/error-handling.md`, and `docs/product/roles-and-permissions/ledger.md`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org admin and org viewer; both read. Writes are 4b.
- [x] Entry point defined — oRPC procedures under `/rpc`, OpenAPI reference at `/api-reference`.
- [x] Preconditions described — authenticated session with an `activeOrganizationId` backed by a real `member` row.
- [x] Happy path described — the seven-step sequence under "Happy path", identical for all seven procedures.
- [x] Error paths described — 401/403/404 for this phase; the full map is in "Error map".
- [x] Permissions considered — both ledger roles may read; `adminProcedure` is defined and tested but unused until 4b. Note that `docs/product/roles-and-permissions/` does **not** yet define `admin`/`viewer` — it holds only an unfilled `EXAMPLE.md`. Filling it is a deliverable of this task and is listed in Scope; until that file lands, this box is backed by decision #2 above rather than by the roles doc.
- [x] Acceptance criteria written
- [x] Tests defined — cross-tenant matrix, role mapping, error map, cursor round-trip, HTTP status slice.
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — seven procedures with path (`POST /rpc/<namespace>/<procedure>`), input schema, and output shape, plus the five wire shapes they compose from.
- [x] Validation described — Zod at the contract boundary: uuid-form ids, `limit` bounded to 1–200 (the server caps independently in `packages/db` regardless), opaque cursors decoded and rejected as `400` when malformed, and a length cap on decimal amount strings before `BigInt` parsing. Domain invariants stay in `packages/core`, never in a handler.
- [x] Error responses defined — status codes, oRPC codes, stable `data.reason` values, and the concrete JSON envelope; `message` is fixed per branch and leaks no internals.
- [x] Side effects listed — none. Every procedure in this task is a read: no row is written, no audit entry recorded, no external call made.

### Frontend
- [x] Loading state defined — N/A: no UI this phase (Phase 5).
- [x] Empty state defined — N/A: no UI this phase.
- [x] Error state defined — N/A: no UI this phase.
- [x] Navigation after each action defined — N/A: no UI this phase.
- [x] Feedback (toast/inline/modal) defined — N/A: no UI this phase.

---

*Started 2026-07-27. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*
