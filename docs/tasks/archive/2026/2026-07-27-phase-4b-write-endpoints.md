# Task: Phase 4b — write endpoints (create account, post transaction, reverse) + rate limiting

## Goal

The ledger becomes writable through its API. An org admin can create an account, post an N-leg balanced transaction, and reverse one — each idempotent, each rate-limited, each rejected with a typed error that is *recorded* rather than lost. A viewer can do none of it. Phase 4a built the foundation (tenancy middleware, role model, wire contracts, the full error map); this phase is its first real consumer, and the first time `adminProcedure`, the `409`/`422` branches of the error map, and `decimalAmountSchema` are exercised by a live endpoint rather than a unit test.

It also closes three defects a survey of the existing write path found, none of which are reachable from Phase 4a's read-only surface:

1. `createAccount` raises a raw `DrizzleQueryError` on a duplicate `(org_id, name)` — an **unhandled 500** today.
2. `lockAccounts` never reads `active`, so posting to a deactivated account **silently succeeds**, contradicting `ledger.md:56`.
3. Failures at `Transaction.create` (unbalanced, `<2` legs, non-positive, currency mismatch) and `IdempotencyConflict` are **never audited**, contradicting `ledger.md:54` and `:65` ("every rejection persisted").

## Status

Done

Reviewed and merged 2026-07-28 (`d24c9cd`, pushed to `origin/main`).

Verified 2026-07-27: `check-types` 6/6, `test` 246 passed (68 core + 28 db + 150 api), `build` 2/2, migration integrity guard PASS. Lint is `N/A` — no linter is wired in this repo yet.

An adversarial review (4 lenses, each finding independently checked by a skeptic and a reproducer) confirmed 8 of 15 raised findings, which deduplicated to 5 distinct defects. All 5 are fixed:

1. **The idempotency-conflict audit write was unguarded**, so a failing audit insert destroyed a correct `409` and returned `500` — losing the rejection twice, and signalling "retry me" to a client that would then loop. The reviewer demonstrated a client-triggerable trigger: an unpaired surrogate in `idempotencyKey` passes `z.string()`, but serializes to invalid JSON and Postgres rejects the `jsonb` insert with `22P02`. Both rejection-audit writes in `post-transaction.ts` are now best-effort, and the conflict metadata records the key's *length* rather than its bytes, keeping a client-supplied string out of a `jsonb` document entirely.
2. **The 30-character amount cap did not bound storability.** A well-formed 30-char amount parses into a 32-digit minor-unit value that no `int8` column can hold, so Postgres would fail with `22003` and the caller would get an unaudited `500`. Added `parseBoundedAmount` and `MAX_MINOR_UNITS`; over-range amounts are now a typed `422 invalid_amount`, with boundary tests on both sides of int8 max.
3. **The org rate limit was charged before the per-user limit could reject.** `limit()` consumes as it checks, so one admin could burn all 60 org tokens with 30 writes plus 30 refusals and lock out every co-admin. The two checks are now ordered user-then-org.
4. **The test guarding the role-check-before-limiter ordering was vacuous** — the viewer was seeded in a *different* org from the admin, so it proved nothing. Rewritten with a `seedMemberIn` fixture so the viewer shares the admin's org.
5. **The 60/min org limit was never exercised** — both `429` tests tripped the 30/min user limit first. Rewritten to use three admins in one org, so the org ceiling is reached with `scope: "organization"`.

Findings 1–3 were product defects; 4–5 were defects in this task's own tests.

Allowed values: `Draft`, `Ready`, `In Progress`, `Human Review`, `Done`, `Cancelled`, `Superseded`.

## Scope (allowed paths)

**`packages/api` — the endpoints:**

- `packages/api/src/**`
- `packages/api/package.json`

**`packages/db` — the three defect fixes (approved, see D6/D7/D8):**

- `packages/db/src/errors.ts`
- `packages/db/src/repositories/accounts.ts`
- `packages/db/src/repositories/audit.ts`
- `packages/db/src/repositories/index.ts`
- `packages/db/src/posting/lock-accounts.ts`
- `packages/db/src/posting/post-transaction.ts`
- `packages/db/src/posting/reserve-key.ts` *(scope expansion — see below)*
- `packages/db/src/internal/pg-errors.ts` *(scope expansion — see below)*

## Scope expansions

**`internal/pg-errors.ts` + `posting/reserve-key.ts` (2026-07-27, during implementation).** D6 rejected duplicating the SQLSTATE `23505` detection into `packages/api` precisely because `getPostgresErrorCode` and its `cause`-chain walk are fragile against a drizzle-orm upgrade. Implementing D6 revealed that the helper is also module-**private** to `posting/reserve-key.ts`, so `repositories/accounts.ts` cannot reach it either — leaving a second copy inside `packages/db` as the only alternative, which fails D6's own test for the same reason. Extracting it once into `internal/pg-errors.ts` and importing it from both call sites keeps a single definition of "how a Postgres error code is recovered from a wrapped driver error". `internal/` is already this package's convention for shared non-exported helpers (`internal/money.ts`), and neither file is added to the public export map.

**Dependency declaration:**

- `pnpm-workspace.yaml`

**Documentation:**

- `docs/adr/0006-write-endpoint-contract.md`
- `docs/adr/0007-rate-limiting.md`
- `docs/adr/README.md`
- `docs/backend/error-handling.md`
- `docs/backend/api-flow.md`
- `docs/development/tech-stack.md`
- `docs/development/framework-companions.md`
- `docs/product/requirements/ledger.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-07-27-phase-4b-write-endpoints.md`

## Out of scope

- **Seed/reset.** Phase 4c.
- **`apps/web`.** Phase 5. `privateData` stays until then.
- **A deactivate-account endpoint.** `ledger.md:62` lists only "create account". The `active` check below is therefore correct but unreachable through the API in this phase — see D7.
- **Blocking double-reversal.** Explicitly allowed; see D4.
- **Structured logging (pino), security headers, graceful shutdown, `/ready`.** Still the API hardening phase's work, tracked in `error-handling.md`'s verification checklist.
- **`packages/core`.** No changes. Every domain invariant this phase relies on already exists and is tested.
- **Schema changes and migrations.** None. The three `packages/db` fixes are code-level; if one turns out to need a migration, stop and re-scope.

## Related docs

- `docs/product/requirements/ledger.md` — §Happy path, §Error paths, §Backend, invariants #1/#3/#4/#6/#7
- `docs/adr/0004-idempotency.md` — the replay-vs-conflict contract this phase drives
- `docs/adr/0003-balance-and-concurrency.md` — ordered locks, rejection-in-a-second-transaction
- `docs/adr/0005-tenant-isolation.md` — the derivation rule every endpoint here inherits
- `docs/tasks/archive/2026/2026-07-27-phase-4a-api-foundation-reads.md` — the foundation and its explicit 4b deferrals

## External sources

- Task/issue: N/A: local phase plan, tracked in `docs/tasks/`.
- Product documentation: `docs/product/requirements/ledger.md` (repo-local source of truth).
- Design: N/A: no UI in this phase.

Library fact verified against the npm registry during design: `@orpc/experimental-ratelimit@1.14.12` exists and is versioned in lockstep with `@orpc/server` (installed: 1.14.10).

## Approved decisions

Nine decisions were surfaced by a parallel survey of the spec, the write path, the 4a foundation, and rate-limiting options, and resolved before implementation. The reasoning is recorded because a future reader will otherwise re-litigate each one.

**D1 — `requestHash` is SHA-256 hex over canonical JSON of the *validated domain payload*.** Legs sorted by `(accountId, direction, amount)`, amounts as decimal strings, `reversesTransactionId` included, and `orgId`/`actorId`/`idempotencyKey` excluded. Sorting is the load-bearing part: `Transaction.deltas()` nets by account before anything is persisted, so two orderings of the same legs produce a byte-identical ledger effect — hashing the caller's order would manufacture a `409` for two requests that are the same request. Amounts must be strings: `bigint` throws in `JSON.stringify`, and a JSON number reintroduces the IEEE-754 error the wire format exists to avoid. `actorId` is excluded per ADR 0004's "same payload" wording; the consequence is that one admin can replay another's result, acceptable because both are already `adminProcedure`-authorized inside the same tenant and the key is org-scoped.

**D2 — The idempotency key travels in the request body**, as a field in the input schema, not an `Idempotency-Key` header. `ledger.md:47` lists it alongside source/destination/amount. A header would require changing `Context` (which carries no headers) and every fixture in the suite, and would be invisible both to `no-org-input.test.ts`'s schema introspection and to the OpenAPI reference. A header alias can be added later without breaking this.

**D3 — `transactions.create` takes a raw postings array**, not a transfer shape. It maps 1:1 onto `Transaction.create`, so no translation layer can introduce an imbalance of its own. Decisively: `too_few_postings` and `unbalanced_transaction` are already *published* reasons in `docs/backend/error-handling.md`, and both are structurally unreachable through a `{source, destination, amount}` shape — adopting it would make two entries of the documented error contract dead code that no test could exercise. `ledger.md:47` reads like a transfer; that line describes the user-facing submission Phase 5's console composes, and this task annotates it rather than leaving the divergence silent.

**D4 — Reversal takes its own caller-supplied idempotency key, and reversing a reversal is allowed.** Nothing in `ledger.md` forbids it, and re-applying a reversed transaction is legitimate. Deriving the key server-side from the original id would overload the idempotency key with a business rule, and a legitimate second reversal would surface as a `409` whose message ("used with a different request payload") would be false. A handler pre-check is racy; the only non-racy block is a partial unique index, i.e. a migration, which is out of scope. Two guardrails are **not** optional: resolve the original through `getTransactionById(db, orgId, id)` because `ledger_transaction`'s self-FK is org-blind, and rebuild the mirrored postings from the **persisted rows**, never from the request body.

**D5 — Rate limiting: `@orpc/experimental-ratelimit`, attached to `adminProcedure`, keyed by org.** The layer is near-decided by the code: both handlers mount under one `app.use("/*")` and every oRPC call is a POST, so a Hono-layer limiter cannot tell a write from a read without a path allowlist duplicating the procedure ladder. `adminProcedure` *is* the write set by construction. `orgId` is the primary key because it is the only identifier in the request the database has vouched for (`requireOrg` validated it against a real `member` row), because everything the limit protects — row locks, the `UNIQUE (org_id, key)` index, balance contention — is org-scoped, and because keying by org guarantees one tenant cannot throttle another. A secondary per-user limit is free, since `actorId` is in the same context. IP is rejected: `Context` carries no headers, a socket peer behind a proxy is a global kill switch, `X-Forwarded-For` is client-controlled, and two orgs behind one NAT would throttle each other. **Limits: 60 writes/min per org, 30/min per user** — recorded here rather than invented in code, since `ledger.md:66` specifies no number. The library **must be wrapped**: it throws `TOO_MANY_REQUESTS` with `data: { limit, remaining, reset }` and no `reason` field, contradicting `error-handling.md`'s "clients switch on `reason`, never on `message`".

**D6 — Duplicate account name becomes a typed `AccountAlreadyExists` → `409 account_name_taken`.** Today it is a raw driver error and an unhandled 500. The alternative — catching SQLSTATE `23505` in `packages/api` — would duplicate `reserve-key.ts`'s module-private `getPostgresErrorCode` and its `cause`-chain walk, which ADR 0004 already records as a real Phase 3 bug and a known fragility against a drizzle-orm upgrade. Doubling that blast radius across two packages is worse than adding one error kind. `409` over `422` because a taken name is a conflict with existing state, matching the system's only other uniqueness conflict.

**D7 — Inactive accounts are rejected under the row lock, as `AccountInactive` → `422 account_inactive`.** `ledger.md:56` requires it and nothing enforces it. It must live inside `lockAccounts`, not in a handler, or it is racy against a concurrent deactivation. It is deliberately **not** collapsed into the existing `AccountNotFound` `404`: the no-enumeration rule exists to prevent *cross-tenant* existence leaks, and within the caller's own org there is nothing to hide — `accountSchema` already exposes `active` on the read surface, so a `404` would contradict what `accounts.list` just told the same caller. Known caveat: this phase ships no deactivate endpoint, so the path is unreachable except via direct database writes. It is implemented anyway because it is cheap while already inside `lockAccounts`, and becomes reachable the moment any deactivation path exists.

**D8 — Pre-persistence rejections are audited via a new `recordRejection` in `packages/db`.** `ledger.md:54` and `:65` require every rejection to be recorded, but unbalanced / `<2`-leg / non-positive / currency-mismatch failures all happen at `Transaction.create`, *before* `postTransaction` is ever called, so `writeRejectionAudit` never fires — and `IdempotencyConflict` is unaudited too. Exporting `recordRejection(db, {...})` mirrors the shape `writeRejectionAudit` already has (which is then refactored onto it) and closes both gaps at once. **`accounts.create` writes no audit entry** in this phase: `ledger.md:65`'s side-effect list describes only the transaction path, and extending the audit vocabulary is not this task's job.

**D9 — Replay responses include balances, documented as "current, as of this response".** A fresh post returns balances computed inside the transaction; a replay re-reads `ledger_account.balance` live, so an idempotent retry legitimately returns the same `transactionId` and the same immutable postings but possibly *different* balances. One response shape is kept for both paths and the semantics are stated in the output schema's `.describe()`, so Phase 5's console does not mistake it for an as-of-posting snapshot.

## Design

### Endpoints (all on `adminProcedure`)

| Procedure | Input | Output |
|---|---|---|
| `accounts.create` | `{ name, currency, type: "normal" \| "external" }` | `Account` |
| `transactions.create` | `{ idempotencyKey, postings: [{ accountId, direction, amount, currency }] }` | `PostedTransaction` |
| `transactions.reverse` | `{ idempotencyKey, transactionId }` | `PostedTransaction` |

`PostedTransaction` = the existing `transactionWithPostingsSchema` plus `balances: Array<{ accountId, balance: Money }>` — the resulting balance per touched account, per `ledger.md:50`.

No input schema contains an org field; `orgId` and `actorId` come from `requireOrg`'s context. `no-org-input.test.ts`'s procedure count and path list must be **updated, never loosened**.

### Handler shape

```
adminProcedure                          role + tenancy already enforced, rate limit applied
  → Zod: shapes, uuid, decimalAmountSchema (30-char cap, before BigInt)
  → Money.parse per leg                 → InvalidAmount / UnsupportedCurrency
  → createPosting per leg               → NonPositiveAmount
  → Transaction.create(postings)        → TooFewPostings / CurrencyMismatch / UnbalancedTransaction
        ↳ on failure: recordRejection(...) THEN throw toORPCError(...)
  → requestHash = sha256(canonical(payload))
  → postTransaction(db, {...})          → AccountNotFound / AccountInactive / InsufficientFunds / IdempotencyConflict
        ↳ on IdempotencyConflict: recordRejection(...) THEN throw
  → map to wire shape
```

Handlers perform **no writes of their own**. Every side effect of a successful post — postings, balances, idempotency row, audit entry — happens inside `postTransaction`'s single Postgres transaction.

### Error additions

| New reason | Origin | Code | Status |
|---|---|---|---|
| `account_name_taken` | `AccountAlreadyExists` (new, `packages/db`) | `CONFLICT` | 409 |
| `account_inactive` | `AccountInactive` (new, `packages/db`) | `UNPROCESSABLE_CONTENT` | 422 |
| `rate_limited` | rate-limit middleware wrapper | `TOO_MANY_REQUESTS` | 429 |

The compile-forced ripple is deliberate: adding a member to `PersistenceError` breaks `errors.ts`'s `never` guard, `LedgerErrorReason`, `MESSAGES`, and `errors.test.ts`'s `covered.size` assertion — all of which must be updated together. That is the exhaustiveness check working.

## Acceptance criteria

- All three write procedures exist on `adminProcedure`; a `viewer` receives `403 insufficient_role` from each — the **first wire-level test of `adminProcedure`**, which has no coverage today.
- Posting an N-leg balanced transaction succeeds and returns resulting balances; posting `<2` legs, mixed currencies, a non-positive amount, or an unbalanced set each returns the documented `422` reason.
- Same key + same payload replays the original transaction: identical `transactionId`, no second posting. Same key + different payload returns `409`. Both proven **under real concurrency** against Testcontainers Postgres, not just sequentially.
- Two requests with the same legs in a **different order** produce the same `requestHash` and therefore replay rather than conflict.
- Overdrawing a `normal` account returns `422 insufficient_funds`, writes no postings, and leaves balances untouched.
- Reversing a transaction produces a mirrored transaction linked via `reverses_transaction_id`, restores both balances, and reversing that reversal is permitted.
- A reversal naming another org's transaction id returns `404`, identical to a missing one.
- Duplicate account name returns `409 account_name_taken` — **not a 500**.
- Posting to an inactive account returns `422 account_inactive`, proven by deactivating a row directly (no API path exists).
- Every rejection above appears in `audit.rejections` with its reason — including the pre-persistence ones and the `409`.
- Exceeding 60 writes/min for an org returns `429` with `data.reason === "rate_limited"`; a second org is unaffected.
- `409`, `422`, and `429` are proven to reach the wire with those statuses in `http.test.ts`, which today covers only 200/400/401/403/404.
- `pnpm-workspace.yaml`, `tech-stack.md`, and `framework-companions.md` declare the rate-limiting library before it is installed (CLAUDE.md rule 6).
- ADRs 0006 and 0007 written and indexed; `ledger.md:47`'s transfer wording reconciled with D3; `error-handling.md` carries the three new reasons and a 429 row.

## Verification

```bash
# N/A: no linter is wired in this repo yet (Biome/oxlint planned) — see CLAUDE.md
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Requires a reachable Docker daemon. If a check fails, fix only the affected area, rerun that check first, then rerun the complete block.

## Retention

On `Done`, move to `docs/tasks/archive/2026/` once ADRs 0006/0007, `error-handling.md`, `ledger.md`, and `test-coverage.md` carry the durable decisions.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org admin writes; viewer is refused. System records rejections.
- [x] Entry point defined — oRPC procedures under `/rpc`, OpenAPI at `/api-reference`.
- [x] Preconditions described — authenticated session, verified `member` row, ledger role `admin`.
- [x] Happy path described — see "Handler shape".
- [x] Error paths described — 403/404/409/422/429 with stable reasons; every rejection audited.
- [x] Permissions considered — `adminProcedure`; `docs/product/roles-and-permissions/ledger.md` already marks all three admin-only.
- [x] Acceptance criteria written
- [x] Tests defined — role denial, N-leg validation matrix, idempotency under concurrency, hash-order equivalence, insufficient funds, reversal round-trip, cross-org reversal, duplicate name, inactive account, rejection auditing, rate limiting, wire-level statuses.
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — three procedures with input and output shapes.
- [x] Validation described — Zod shapes/uuid/length caps at the boundary; domain invariants in `packages/core`; `active` and funds checks under the row lock.
- [x] Error responses defined — three new reasons plus the existing map; stable codes, no internals leaked.
- [x] Side effects listed — postings, balances, idempotency row, audit entry, all inside `postTransaction`'s transaction; plus a separate rejection audit for pre-persistence failures. `accounts.create` writes one row and no audit entry.

### Frontend
- [x] Loading state defined — N/A: no UI this phase (Phase 5).
- [x] Empty state defined — N/A: no UI this phase.
- [x] Error state defined — N/A: no UI this phase.
- [x] Navigation after each action defined — N/A: no UI this phase.
- [x] Feedback (toast/inline/modal) defined — N/A: no UI this phase.

---

*Started 2026-07-27. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*
