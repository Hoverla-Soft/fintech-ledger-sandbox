# Task: Phase 4c — sandbox seed and reset

## Goal

The sandbox becomes re-runnable. An org admin can seed their organization with the four scenarios `docs/product/requirements/ledger.md:80` names as the acceptance bar — a payroll run, a marketplace payout with fees, an insufficient-funds rejection, and a reversal — and can reset the organization back to a zero state and seed it again, indefinitely. Reconciliation returns clean at every point in that loop.

This is the last of three Phase 4 slices and the one that closes `ledger.md:63`'s endpoint list. It introduces **no new write path into the ledger**: seed and reset are both composed entirely from `postTransaction`, `listAccounts`, `createAccount`, and `getTransactionById`, all shipped and tested in Phases 3 and 4b. `packages/db` is not modified and there is no migration.

It also resolves the open consequence ADR 0005 recorded against itself — *"Phase 4c's seed/reset is the first such caller and must address this explicitly"* — by declining to become that caller at all. See D3.

## Status

Human Review

Verified 2026-07-28: `check-types` 6/6, `test` 324 passed (68 core + 28 db + 228 api), `build` 2/2, migration integrity guard PASS (exit 0, and this phase adds no migration). Lint is `N/A` — no linter is wired in this repo yet.

The api suite grew 150 → 228: 21 integration tests in `routers/sandbox.test.ts`, 23 pure tests in `sandbox/reset-plan.test.ts`, 32 in `sandbox/scenarios.test.ts`, and 2 more from `no-org-input.test.ts`'s per-procedure matrix.

Three findings from the guard reviews were applied or recorded:

1. **`spec-completeness-guard` found four gaps in this file before implementation started** — a false checkmark on "API endpoints defined" (no method/path), a key collision in scenario 4 (it posts two transactions but was specified with one key, which would have made the reversal conflict with its own original), an ambiguous per-call bound across multiple currencies, and a missing mid-run failure path for seed. All fixed above.
2. **`backend-architecture-guard` found an unchecked `string → Currency` assertion** in `suspenseAccountSpec`. The value originates as a `Currency` on `LedgerAccountRow` and was being widened through `ResetBalance.currency` only to be cast back. `Currency` is now threaded through `reset-plan.ts` and the assertion is gone.
3. **`backend-reliability-security-guard` surfaced no in-scope defect** but three behaviours worth recording rather than shipping silently: concurrent resets do not degrade cleanly (the loser gets a misleading `422 insufficient_funds`), reset reads the unpaginated account list twice per call, and a reset chunk is the largest lock footprint in the system. All three are written up as Consequences in ADR 0008.

One specification item proved unimplementable and was corrected rather than forced: a `replayed` scenario outcome. `PostedTransaction` carries no replay flag and ADR 0006 records that absence as a known consequence, so a replayed scenario reports `posted` with the original transaction id.

Allowed values: `Draft`, `Ready`, `In Progress`, `Human Review`, `Done`, `Cancelled`, `Superseded`.

## Scope (allowed paths)

**`packages/api` — the endpoints:**

- `packages/api/src/routers/sandbox.ts`
- `packages/api/src/routers/sandbox.test.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/routers/no-org-input.test.ts`
- `packages/api/src/sandbox/**`
- `packages/api/src/contracts/wire.ts`
- `packages/api/src/test/fixtures.ts`

**Documentation:**

- `docs/adr/0008-sandbox-reset.md`
- `docs/adr/README.md`
- `docs/backend/api-flow.md`
- `docs/product/requirements/ledger.md`
- `docs/product/roles-and-permissions/ledger.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-07-28-phase-4c-seed-reset.md`

## Out of scope

- **`packages/db`.** No schema change, no migration, no new repository. Everything this phase needs already exists and is tested. If an implementation step appears to require a `packages/db` change, **stop and re-scope** — that is a signal the design was wrong, not a small expansion.
- **`packages/core`.** No domain change. Every rule seed and reset rely on (balance, positivity, currency agreement, funds) is already enforced and tested there.
- **The immutability trigger** (`drizzle/0002_ledger_posting_immutability_trigger.sql`). Not weakened, not made conditional, not given a bypass. D1 exists specifically so it stays absolute.
- **`apps/web`.** The console's seed/reset UI is Phase 5. `privateData` stays until then.
- **A CLI seed script.** See D3 — rejected, not deferred-with-intent.
- **A deactivate/reactivate account endpoint.** D2 is designed so this phase does not need one.
- **Structured logging (pino), security headers, graceful shutdown, `/ready`.** Still the API hardening phase's work, tracked in `docs/backend/error-handling.md`'s verification checklist.

## Related docs

- `docs/product/requirements/ledger.md` — §Summary ("safe to seed and reset"), §Acceptance criteria (the four scenarios), invariants #2/#6/#7/#8
- `docs/adr/0003-balance-and-concurrency.md` — ordered locks, which reset inherits unchanged via `postTransaction`
- `docs/adr/0004-idempotency.md` — the replay-vs-conflict contract D4 and D6 build on
- `docs/adr/0005-tenant-isolation.md` — the derivation rule, and the open consequence D3 resolves
- `docs/adr/0006-write-endpoint-contract.md` — the wire contract these two endpoints follow
- `docs/adr/0007-rate-limiting.md` — the limiter both endpoints inherit; see D5's amplification note
- `docs/tasks/archive/2026/2026-07-27-phase-4b-write-endpoints.md` — D1–D9, the patterns this phase conforms to

## External sources

- Task/issue: N/A: local phase plan, tracked in `docs/tasks/`.
- Product documentation: `docs/product/requirements/ledger.md` (repo-local source of truth).
- Design: N/A: no UI in this phase.

No new dependency is introduced by this phase.

## Approved decisions

Seven decisions were resolved before implementation. The reasoning is recorded because a future reader will otherwise re-litigate each one — particularly D1, whose obvious-looking alternative is wrong in a way that only shows up on a specific history.

**D1 — Reset is a compensating entry, not a reversal of each transaction.** Reset reads every account with a non-zero balance, groups by currency, and posts one balanced transaction per currency whose legs are the opposite of each balance. It does **not** walk the transaction history posting a reversal per transaction.

That alternative is the intuitive one and it does not work. Phase 4b's D4 deliberately allows reversing a reversal, which admits this history:

```
T1  debit A 100, credit B 100     A=+100  B=-100
R1  reverses T1                   A=   0  B=   0
R2  reverses R1  (allowed by D4)  A=+100  B=-100
```

Under *"reverse everything un-reversed that is not itself a reversal"*, T1 is already reversed and R1/R2 are reversals, so nothing is selected and reset silently leaves the ledger at ±100. Under *"reverse anything un-reversed"*, R2 is selected and reversed by R3 (balances reach zero), but the next call finds R3 un-reversed and posts R4, returning to ±100 — it oscillates and never terminates. No simple predicate over the reversal graph is both correct and terminating.

The compensating entry is balanced by construction and needs no plug figure: every transaction nets to zero, so within a currency the sum of all account balances is already zero, and legs of `-balance` therefore sum to zero as well. Every `normal` account lands exactly at zero without passing through negative, so invariant #6 holds with no special case, and the result is correct regardless of what shape the history has. Crucially it is still an ordinary domain write — invariant #8 and the immutability trigger are untouched, and history only grows.

**D2 — Reset leaves accounts alive, active, and at zero.** It unwinds the money and stops. Deactivating them was considered and is a one-way door: `ledger_account` has `UNIQUE (org_id, name)` and Phase 4b's D7 rejects postings to an inactive account, so a subsequent seed could neither reuse those accounts (`422 account_inactive`) nor recreate them (`409 account_name_taken`). An org could be reset exactly once and never seeded again. Leaving them active keeps the seed → reset → seed loop working forever, requires no account-reactivation surface this phase was not asked to build, and gives reset a single meaning — "the money is unwound" — rather than two.

**D3 — Seed and reset are oRPC procedures on `adminProcedure`, and nothing else.** No CLI script, no direct `packages/db` caller. `orgId` and `actorId` come from the `member` row `requireOrg` verified, so this phase creates no path that holds an org id no middleware vouched for. This is the resolution of ADR 0005's open consequence, and it resolves it by **never opening the hole** rather than by inventing a second derivation rule to govern it — a stronger outcome than the ADR anticipated. It also matches `ledger.md:63`, which lists seed/reset among the oRPC endpoints, and `:43`, which puts it in the console. Practically, a script would have to conjure or look up both an `organization` row and a `user` row (`ledger_transaction.created_by` is `NOT NULL` with no cascade); an API caller already is both.

**D4 — Seed takes a caller-supplied run key; each scenario derives its own from it.** `sandbox.seed({ idempotencyKey })`, matching Phase 4b's D2, with per-scenario keys of the form `` `${runKey}:${scenarioId}` ``. Same key replays and posts nothing new; a fresh key seeds an independent run. The load-bearing benefit is resumption: a seed interrupted midway can be re-driven with the same key, and the transactions that already landed replay while only the missing ones post.

A server-generated run id was rejected because it would make seed the only non-idempotent write in the system and leave a client that retried after a timeout silently double-seeded. Fixed per-org keys were rejected because they are fatal to the loop — after a reset, a second seed would replay the original transactions and post nothing, leaving every balance at zero.

**Documented caveat:** seed is idempotent for the four posting scenarios but **not** for the insufficient-funds one. `packages/db/src/posting/post-transaction.ts:128-139` records that a rejected attempt rolls its own key reservation back, so the key never persists; a replayed run re-attempts that transfer and appends a second rejection audit entry. No money moves and no transaction is duplicated. This is stated rather than smoothed over — calling seed "idempotent" without the qualifier would be false.

**D5 — Reset is bounded per call and resumable.** One call zeroes at most `RESET_CHUNK_SIZE` (99) accounts and returns `{ accountsZeroed, remaining }`; the caller loops until `remaining` is `0`. Each chunk is one `postTransaction` in its own database transaction, so progress is durable, an interrupted reset simply resumes, and no single request holds locks or burns CPU proportional to ledger size. Unwinding everything in one request was rejected because its cost is invisible from its signature and a mid-way timeout tells the caller nothing about how far it got; a single all-or-nothing database transaction was rejected because it would need a new posting primitive that composes N transactions under one `BEGIN` and would hold row locks across every account in the org, which is the contention ADR 0003's ordered locking exists to avoid.

**Known amplification, recorded rather than discovered later:** one call to either endpoint costs one rate-limit token but performs several `postTransaction` runs — a fixed ~6 for seed, up to one per chunk for reset. Reset's is bounded by this decision. Seed's is a compile-time constant. Neither is unbounded, which is the property that matters.

**D6 — Chunk keys are content-derived beneath the caller's run key.** `` `${runKey}:${sha256(sorted (accountId, signedAmount) pairs)}` ``. Content-derived so a retried chunk replays instead of double-posting, and so a resumed reset re-derives the same key for the same remaining work. Scoped under a caller-supplied run key because a purely content-derived key would collide across generations: seed → reset → seed(new key) → reset would produce a byte-identical second chunk, replay the first reset's transaction, and leave the balances standing. Chunks within one reset are disjoint by account, so two of them cannot hash alike.

**D7 — Reset fails loudly on an unbalanced ledger.** If a currency's balances do not already sum to zero, the compensating transaction is genuinely unbalanced and `Transaction.create` rejects it as `422 unbalanced_transaction`. Reset does not force the balances to zero anyway. Reset is the tool one reaches for on a sandbox that looks wrong, and papering over a reconciliation break — the exact condition invariant #2 exists to detect — would destroy the evidence at the moment it is most needed.

## Design

### Components

| File | Purpose |
|---|---|
| `packages/api/src/routers/sandbox.ts` | `sandbox.seed`, `sandbox.reset` — both `adminProcedure` |
| `packages/api/src/sandbox/scenarios.ts` | the scenario set as declarative data, plus its account requirements |
| `packages/api/src/sandbox/reset-plan.ts` | pure: non-zero balances → chunked leg plans + chunk keys |

`reset-plan.ts` and `scenarios.ts` are pure and hold no database dependency, so the chunking algebra and the balance of every scenario are testable without Testcontainers. Only the wiring needs a live database.

### Endpoints

Both are oRPC procedures on the existing router, so both handlers mount them automatically — `apps/server/src/index.ts` already routes `RPCHandler` at prefix `/rpc` and `OpenAPIHandler` at `/api-reference`. Every oRPC call is a `POST`.

| Procedure | RPC | OpenAPI reference |
|---|---|---|
| `sandbox.seed` | `POST /rpc/sandbox/seed` | `POST /api-reference/sandbox/seed` |
| `sandbox.reset` | `POST /rpc/sandbox/reset` | `POST /api-reference/sandbox/reset` |

### `sandbox.seed`

Input `{ idempotencyKey: string (1..200) }`. No org identifier — ADR 0005.

1. **Reconcile accounts by name.** `listAccounts(db, orgId)`, match the required set by name, `createAccount` only what is missing. Reuse is what makes D2's loop work. A concurrent seed losing the `AccountAlreadyExists` race is treated as "already present", not an error.
2. **Run the scenarios in order**, each with key `` `${runKey}:${scenarioId}` ``.
3. **Return** the account set and a per-scenario outcome — `posted` with its transaction id, or `rejected` with its reason.

A `replayed` outcome was specified here originally and is **not implementable**: `PostedTransaction` (`packages/db/src/posting/post-transaction.ts:34-43`) carries no replay flag, and ADR 0006 records that absence as a known consequence ("there is no `replayed: true` flag to switch on"). A replayed scenario is therefore reported as `posted` with the original transaction id, which is what it is. Distinguishing the two would mean changing a `packages/db` return type — out of scope, and not worth it for a reporting nicety.

**When a scenario fails unexpectedly**, seed stops at that scenario and propagates the error through the normal map (`toORPCError`) — it does not continue with the remaining scenarios, because each one assumes the balances the previous ones established. Scenario 3 is the sole exception, being an *expected* rejection. Earlier scenarios that already posted stay posted; that is not a partial-failure defect but the resumption path D4 exists for — re-calling seed with the **same** run key replays what landed and posts only what is missing. The response therefore always reports an outcome for every scenario attempted, and the error names the scenario that stopped the run.

Required accounts (all `USD`):

| Name | Type |
|---|---|
| `Sandbox Funding` | `external` |
| `Operating` | `normal` |
| `Employee A` | `normal` |
| `Employee B` | `normal` |
| `Marketplace Seller` | `normal` |
| `Platform Fees` | `normal` |

Scenarios (amounts shown as wire decimals; stored as minor units):

| # | `scenarioId` | Postings | Expected outcome |
|---|---|---|---|
| 0 | `funding` | debit `Operating` 5000.00, credit `Sandbox Funding` 5000.00 | posted |
| 1 | `payroll` | debit `Employee A` 1500.00, debit `Employee B` 1000.00, credit `Operating` 2500.00 | posted |
| 2 | `marketplace_payout` | debit `Marketplace Seller` 950.00, debit `Platform Fees` 50.00, credit `Operating` 1000.00 | posted |
| 3 | `insufficient_funds` | debit `Marketplace Seller` 999999.99, credit `Employee A` 999999.99 | **rejected** (`insufficient_funds`) |
| 4 | `reversal` | debit `Marketplace Seller` 200.00, credit `Operating` 200.00, then reverse it | posted ×2 |

Scenario 4 posts **two** transactions and therefore needs two distinct keys — `` `${runKey}:reversal:original` `` and `` `${runKey}:reversal:reversal` ``. A single `` `${runKey}:reversal` `` for both would make the second post collide with the first as an `IdempotencyConflict`. Every other scenario is one transaction and uses `` `${runKey}:${scenarioId}` `` directly.

Scenario 0 is infrastructure rather than one of the four the acceptance criterion names: `external` accounts may go negative, so it is how money legitimately enters the sandbox. Scenario 3 is *expected* to fail — seed catches `InsufficientFunds`, records it as that scenario's outcome, and does not fail the request; `postTransaction` writes the rejection audit entry itself, so `audit.rejections` has something real to show. Scenario 4's reversal rebuilds its mirrored legs from the **persisted rows**, never from the request body, per Phase 4b's D4 guardrail.

### `sandbox.reset`

Input `{ idempotencyKey: string (1..200) }`. Output `{ accountsZeroed: number, remaining: number, transactionIds: string[] }`.

```
listAccounts → filter balance ≠ 0 → group by currency
  ≤ 99 non-zero accounts in a currency
      → one transaction, one opposing leg per account, no suspense account
  > 99
      → chunks of 99 + one leg against a per-currency `Sandbox Suspense`
        (external) account that absorbs the chunk's imbalance; the final
        chunk drives suspense itself back to zero
```

`MAX_POSTINGS` is 100, so 99 accounts plus at most one suspense leg fits exactly. The suspense account is created **only when chunking is actually required**, so an ordinary sandbox never grows an artifact account. `external` accounts may go negative, so the suspense leg is legal by construction.

**One call processes exactly one chunk — at most 99 accounts in total, not 99 per currency.** Currencies are taken in a deterministic order (ascending ISO code) and the call zeroes the first chunk it finds; `remaining` counts every non-zero account across *all* currencies, so a caller looping until `remaining === 0` drains every currency without needing to know how many there are. A transaction is single-currency (invariant #7), so a chunk never spans two.

Termination: each chunk zeroes its accounts permanently, and because the currency's balances sum to zero, the final chunk's suspense leg is exactly the negation of what remains. A reset run against an already-zero ledger is a no-op returning `remaining: 0`.

### Wire contract

Both endpoints follow ADR 0006 unchanged: no `orgId` is ever emitted or accepted, amounts are decimal strings, timestamps are ISO-8601.

## Acceptance criteria

- `sandbox.seed` followed by `reconciliation.verify` returns clean — `ledger.md:80`'s stated bar, across all four named scenarios.
- Seeding twice with the same run key posts no new transactions; with different keys it produces two independent scenario sets.
- After seed, `audit.rejections` contains the `insufficient_funds` rejection.
- After `sandbox.reset` reports `remaining: 0`, **every account balance is zero and every account is still `active`**.
- The full loop runs twice: seed → reset → seed → reset, with reconciliation clean at each step.
- Reset drives balances to zero on a history containing a double reversal (`T1 → R1 → R2`) — the case that rules out the per-transaction model (D1).
- Reset on an empty or already-zero ledger is a no-op reporting `remaining: 0`.
- With more than 99 non-zero accounts in one currency, reset completes over multiple calls via the suspense path and ends at `remaining: 0`.
- With non-zero accounts in **two** currencies, looping until `remaining: 0` zeroes both, and no single transaction ever spans two currencies.
- A `viewer` receives `403 insufficient_role` from both endpoints; seeding org A leaves org B entirely untouched.
- `no-org-input.test.ts` passes with its procedure count raised by two, and neither new input schema contains an org identifier.
- Pure unit tests cover the chunk boundary at exactly 99/100 accounts, mixed currencies, and that every scenario's postings sum to zero.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

All checks are required unless explicitly `N/A: <reason>` for this project. If a check fails, fix only the affected area, rerun that check first, then rerun the complete verification block before marking the task done.

The migration integrity guard is included even though this phase adds no migration — precisely so that a change which unexpectedly *does* touch migration state is caught rather than assumed absent.

## Retention

Task files are working records. When this task reaches `Done`, `Cancelled`, or `Superseded`, move it from `docs/tasks/` to `docs/tasks/archive/2026/`.

Before archiving, D1 (the reset model and why per-transaction reversal fails) and D3 (the ADR 0005 resolution) must be captured in `docs/adr/0008-sandbox-reset.md`; they are the two decisions a future reader is most likely to re-litigate.

## Spec completeness checklist

Copied from `docs/product/FEATURE-CHECKLIST.md`.

### Common
- [x] Actor(s) defined — org admin (`ledger.md:32`); `viewer` explicitly denied
- [x] Entry point defined — `sandbox.seed` / `sandbox.reset` oRPC procedures
- [x] Preconditions described — signed-in user with a verified `member` row and `admin` role
- [x] Happy path described — §Design, both endpoints
- [x] Error paths described — §Design, D7, and the error responses below
- [x] Permissions considered — `adminProcedure`; the Phase 4c row in `docs/product/roles-and-permissions/ledger.md`
- [x] Acceptance criteria written
- [x] Tests defined — §Acceptance criteria
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — two, both `adminProcedure`
- [x] Validation described — Zod at the boundary; domain rules stay in `packages/core`
- [x] Error responses defined — `403 insufficient_role` (viewer), `403` (no/invalid org), `429` (write budget), `422 unbalanced_transaction` (D7); seed's scenario 3 is an outcome, not an error
- [x] Side effects listed — postings inserted, balances updated, idempotency keys stored, audit entries written; accounts created only when missing; nothing else

### Frontend
- [ ] Loading state defined — N/A: no UI in this phase; the console's seed/reset screen is Phase 5 (`ledger.md:43`, §Frontend)
- [ ] Empty state defined — N/A: as above
- [ ] Error state defined — N/A: as above
- [ ] Navigation after each action defined — N/A: as above
- [ ] Feedback (toast/inline/modal) defined — N/A: as above

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*
