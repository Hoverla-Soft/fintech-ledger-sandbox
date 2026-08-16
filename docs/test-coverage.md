# Test coverage

---

## Framework & setup

| Item | Value |
|---|---|
| Framework | Vitest 4 |
| Test location | `packages/core/src/**/*.test.ts` (unit), `packages/db/src/**/*.test.ts` (integration), `packages/api/src/**/*.test.ts` (unit + integration), `apps/web/src/**/*.test.{ts,tsx}` (unit + component) |
| Test type | `packages/core`: unit (no database). `packages/db` and `packages/api`: integration — real Postgres via Testcontainers, requires a reachable Docker daemon (see `docs/development/testing-rules.md`). `packages/api` additionally holds pure unit files (role mapping, error map, wire codecs) that need no database but share the suite's container lifecycle. `apps/web`: unit and component — `happy-dom` environment with `@testing-library/react`, added Phase 5a. No database and **no Docker**; files run in parallel |

## Running tests

```bash
pnpm test          # all tests (turbo runs each package's `test` task)
pnpm --filter @fintech-ledger-sandbox/core test   # core suite only
pnpm --filter @fintech-ledger-sandbox/core test:watch
pnpm --filter @fintech-ledger-sandbox/db test     # db suite only — needs Docker
pnpm --filter @fintech-ledger-sandbox/api test    # api suite only — needs Docker
pnpm --filter web test                            # console suite only — no Docker needed
```

`packages/db` and `packages/api` each declare a dedicated `#test` task in `turbo.json` with `cache: false`. A Testcontainers suite is not a pure function of its source inputs — Docker availability and applied migrations are environmental — so a cached "pass" could be replayed for a run that never started a container.

---

## Test suites

Index of what's covered, one entry per test file — not the test code itself, just a map so "is there a test for X" is answerable without grepping.

Scope note: `packages/core` is a pure domain with no database or HTTP. These suites cover only the invariants a pure domain can enforce from `docs/product/requirements/ledger.md` — #1 (money conserved), #6 (sufficient funds), #7 (currency match) — plus positivity, minimum-legs, and reversal correctness. Invariants #2 (reconciliation), #3 (atomicity), #4 (idempotency), #5 (tenant isolation), and #8 (immutable history) are DB/API-enforced (Phases 3–4) and are **not** covered here.

### `packages/core/src/money/currency.test.ts`
- `parseCurrency` accepts every currency on the known-exponent allowlist (USD, EUR, GBP, UAH, CHF, PLN, JPY, ISK, BHD, KWD)
- `parseCurrency` rejects an unrecognized code with a typed `UnsupportedCurrency` (never a default exponent)
- `parseCurrency` rejects the empty string
- `parseCurrency` is case-sensitive (`"usd"` rejected) and never treats an inherited `Object.prototype` member (`"toString"`) as a known currency
- `minorUnitExponent` reports the correct ISO-4217 exponent for exponent-2 (USD), exponent-0 (JPY), and exponent-3 (BHD) currencies
- `CURRENCIES` (added Phase 5a for the console's picker) lists exactly the allowlist and **agrees with `parseCurrency` in both directions** — everything offered is accepted, and everything accepted is offered, so a picker can neither present a code the parser rejects nor hide one it would take. Asserted against a hand-written literal rather than the export itself, so deleting a currency from the implementation cannot delete it from the test
- `CURRENCIES` is grouped by exponent (the order a picker renders) and is frozen, so a consumer cannot mutate the shared allowlist at runtime

### `packages/core/src/money/money.test.ts`
- `Money.ofMinorUnits` accepts a genuine `bigint`; rejects an integral number, `NaN`, and a float cast through `as unknown as bigint` with `InvalidAmount` / `"not-a-bigint"` — never uses `number` for amounts
- `Money.ofMinorUnits` and `Money.parse` both reject an unknown currency with `UnsupportedCurrency`, never defaulting to exponent 2
- `Money.parse` / `.format()` round-trip by value (re-parsed `minorUnits`, not string equality) for exponent-2 USD, exponent-0 JPY, and exponent-3 BHD; a short decimal (`"1.5"`) formats padded to the currency's exponent (`"1.50"`)
- `Money.parse` round-trips negative decimal strings the same way at exponent-2 USD (`"-12.34"`), exponent-0 JPY (`"-5"`), and exponent-3 BHD (`"-0.005"`); the zero-integer-part case (`"-0.05"` USD) parses to `-5n` and formats back to exactly `"-0.05"`, never `"-.05"` or `"0.-05"`; `"-0"` and `"-0.00"` both parse to `0n` and report `isZero()`, proving there is no distinct negative-zero value; a negative parsed amount reports `isNegative() === true` and `isPositive() === false`
- `Money.parse` rejects malformed decimal strings (`""`, `"abc"`, `"NaN"`, `"Infinity"`, `"1e5"`, `".5"`, `"1."`, `"-"`, `"--5"`) with `"malformed-decimal"`
- `Money.parse` rejects excess fraction precision (`"1.5"` JPY, `"0.0001"` USD) with `"excess-precision"` rather than rounding; the same fraction digit succeeds for USD
- `Money.format()` renders negative USD (`-5` minor units → `"-0.05"`) and sub-unit exponent-3 BHD (`5n` → `"0.005"`) correctly
- `add` / `subtract` / `compare` reject mismatched currencies with `CurrencyMismatch` (correct `expected`/`actual`) and leak no numeric result (`Result` has only `ok`/`error` keys); `compare` orders same-currency amounts by minor units
- Arithmetic exactness beyond IEEE-754 doubles: `0.10 + 0.20` USD sums to exactly `30n` minor units; a `minorUnits` value beyond `Number.MAX_SAFE_INTEGER` round-trips through `add` exactly, proving `bigint` is real
- `negate` / `isZero` / `isPositive` / `isNegative` / `equals` value helpers

### `packages/core/src/transaction/posting.test.ts`
- `createPosting` accepts a strictly positive amount; rejects a zero or negative amount with `NonPositiveAmount`
- `signedAmount` is positive for a debit and negative for a credit — the sign convention `packages/db` depends on

### `packages/core/src/transaction/transaction.test.ts`
- `Transaction.create` rejects zero and one posting with `TooFewPostings` (correct `count`)
- `Transaction.create` rejects mixed currencies with `CurrencyMismatch`
- `Transaction.create` rejects an unbalanced posting set with `UnbalancedTransaction` and the correct reported `net`
- `Transaction.create` accepts a balanced 2-leg transfer and an N-leg (one debit, two-credit split) transaction
- `Transaction.create` validates in order — leg count → currency → positivity → balance — reporting `CurrencyMismatch` before `NonPositiveAmount`, and `NonPositiveAmount` before `UnbalancedTransaction`, when a posting set violates more than one rule at once
- `Transaction.deltas()` aggregates multiple postings against the same account into one net entry
- `reverse(txn)` yields a balanced, same-currency, same-leg-count transaction
- `reverse(txn)`'s per-account deltas are the exact negation of the original's `deltas()`
- `reverse(reverse(txn))` restores the original per-account deltas

### `packages/core/src/account/account.test.ts`
- `applyDelta` on a `normal` account accepts a delta keeping the balance positive; rejects a delta that would drive it below zero with `InsufficientFunds` (correct `accountId` and negative `resulting`); accepts a delta landing exactly at zero (boundary — zero is not negative)
- `applyDelta` on an `external` account accepts the same negative-driving delta a `normal` account rejects
- `applyDelta` returns `CurrencyMismatch` — not `InsufficientFunds` — when the `balance` currency or the `delta` currency disagrees with the account, proving the currency check runs before the funds rule

---

Scope note: `packages/db`'s suite is **integration**, not unit — real Postgres via Testcontainers (`src/test/setup.ts`), requiring a reachable Docker daemon. `postTransaction`'s own file below is a small smoke test proving the harness works end to end; the files after it are the full per-invariant (#2–#6, #8) and `ledger.md` scenario acceptance suite. The acceptance-suite files share one Postgres container for the whole `packages/db` vitest run (`src/test/global-setup.ts`, wired via `vitest.config.ts`'s `globalSetup` + `fileParallelism: false`) instead of one per file; the pre-existing smoke test below keeps its own isolated container via `startTestDatabase()`.

### `packages/db/src/posting/post-transaction.test.ts`
- A balanced transfer (`external` funding source → `normal` destination) commits: both account balances update to the expected minor units, exactly one `ledger_transaction` and two `ledger_posting` rows exist, and one `ledger_audit_entry` with `outcome = "posted"` is recorded
- A transfer that would drive a `normal` account negative is rejected with `InsufficientFunds`: both balances stay unchanged, zero `ledger_transaction`/`ledger_posting` rows are written, and exactly one `ledger_audit_entry` with `outcome = "rejected"` / `reason = "insufficient_funds"` is recorded — proving the rejection-recording-in-a-second-transaction design actually leaves a trace after the main transaction rolls back (this is also the acceptance test for that rejection-recording design named explicitly in `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`)

### `packages/db/src/posting/post-transaction.atomicity.test.ts`
- Invariant #3 (atomicity): a failure injected via a temporary, test-only trigger on `ledger_account` (never a change to `post-transaction.ts` itself) right at the first balance-update attempt — i.e. immediately after the posting insert, before any balance update — leaves zero `ledger_posting` rows, zero `ledger_transaction` rows, zero `ledger_idempotency_key` rows, and every account balance byte-identical to before the attempt
- The same failure injected on the *second* balance update of a 3-account transfer proves Postgres rolls back an already-applied first update too — the same zero/unchanged assertions hold even though one balance update genuinely succeeded before the abort

### `packages/db/src/posting/post-transaction.concurrency.test.ts`
- Invariant #4 (idempotency under concurrency): `N` real concurrent `postTransaction` calls (via `Promise.all` over real, separate `pg.Pool` connections, never sequential `await`s) sharing one idempotency key and request hash produce exactly one `ledger_transaction` row, and every caller — winner and replays alike — receives the identical transaction id
- A second, sequential call with the same key and the same request hash replays the original result: same transaction id, no second posting
- A second, sequential call with the same key but a different request hash returns `IdempotencyConflict` and posts nothing new
- Under real concurrency, a mix of matching- and mismatched-request-hash callers sharing one key converges to exactly one posted transaction; every other caller either replays it or gets `IdempotencyConflict` — assertions hold regardless of which caller wins the underlying race
- Invariant #6 (sufficient funds under contention): five concurrent withdrawal attempts draining a `normal` account with only enough balance for three succeed exactly 3-for-3/2-for-fail every run (deterministic by amount, not by which specific attempt wins the row lock), the account's final balance is never negative, the funding `external` account is left negative, and reconciliation stays clean

### `packages/db/src/repositories/tenant-isolation.test.ts`
- Invariant #5 (no cross-tenant leakage), covering every read repository plus `postTransaction` itself, each with both a positive control and the cross-org negative case: `getAccountById` returns the identical `AccountNotFound` shape for a genuinely missing id and for a real id owned by another org; `listAccounts` never returns another org's accounts even when both orgs use an identical account name; `getTransactionById` reports the identical `TransactionNotFound` for another org's real transaction id and a missing one; `listTransactions` never includes another org's transactions; `reconcileAccounts` never includes another org's accounts or postings; `listAuditEntries`/`listRejections` never return another org's audit rows
- `postTransaction`: a transaction referencing an account id that belongs to another org is rejected with the same `AccountNotFound` a missing id would produce, posts nothing under the calling org, leaves the foreign account's balance untouched, and records its rejection audit entry under the *calling* org, never the account's real owner
- Boundary: a brand-new org with no accounts or transactions gets empty lists everywhere (accounts, transactions, audit, rejections, reconciliation), never an error

### `packages/db/src/schema/ledger-immutability.test.ts`
- Invariant #8 (immutable history): a direct `UPDATE` on `ledger_posting` is rejected by the database trigger and leaves the row unchanged; a direct `DELETE` is rejected and leaves the row in place
- `TRUNCATE TABLE ledger_posting` is rejected too — a real gap found in review, since `TRUNCATE` never fires row-level triggers in Postgres and needs its own statement-level trigger (`drizzle/0002_ledger_posting_immutability_trigger.sql`)
- The only sanctioned correction path — a reversing transaction linked via `reverses_transaction_id` — posts successfully, is retrievable with the correct linkage, and never mutates the original transaction's posting rows (byte-identical before/after)

### `packages/db/src/posting/ledger-scenarios.test.ts`
- The four `docs/product/requirements/ledger.md` acceptance scenarios, each ending with a clean `reconcileAccounts` check (invariant #2) across realistic multi-leg shapes, not just a simple 2-leg transfer: (1) payroll run — one `external` funding account pays three employee `normal` accounts in a single 4-leg transaction; (2) marketplace payout with fees — a 3-leg transaction with a platform-fee leg nets to the `external` escrow debit; (3) insufficient-funds rejection — balances and reconciliation stay untouched, exactly one rejection is recorded; (4) reversal — a reversing transaction linked via `reverses_transaction_id` restores both accounts to their pre-transaction balances

### `packages/db/src/repositories/reconciliation.test.ts`
- Invariant #2 boundary case: a freshly created account with no postings reconciles cleanly at zero
- Proves `reconcileAccounts` actually *detects* drift rather than always reporting `reconciled: true`: directly corrupting `ledger_account.balance` via raw SQL (bypassing `postTransaction` entirely) is reported as `reconciled: false` with the correct computed-vs-recorded mismatch

---

Scope note: `packages/api`'s suite covers the **API boundary** — that the acting organization is derived rather than accepted (ADR 0005), that domain errors become the right HTTP status, and that money and cursors cross the wire without loss. It shares one Postgres container per run via `src/test/global-setup.ts`, which reuses `packages/db`'s published harness (`@fintech-ledger-sandbox/db/testing`) rather than standing up a second one.

### `packages/api/src/auth/roles.test.ts`
- `toLedgerRole` maps Better Auth's `owner`/`admin` to ledger `admin` and `member` to `viewer`, case-insensitively and tolerating surrounding whitespace
- **Fails closed:** every unrecognized value (`""`, `"guest"`, `"superuser"`, `"administrator"`, …) maps to `viewer`, never `admin`
- Multi-role columns (`"admin,member"`, `"member, admin"`) grant `admin` when any element is a write role — a whole-string comparison would silently demote a genuine admin

### `packages/api/src/errors.test.ts`
- All ten members of the `LedgerApiError` union map to the documented oRPC code and HTTP status (404 / 409 / 422), asserted from a table typed as the union itself so it cannot fall behind the code
- No branch interpolates the offending identifier or a balance into its `message` — a probed account id appears nowhere in the serialized error, which is what keeps a cross-org 404 from confirming id validity
- No branch ever produces `403`: role denial happens in middleware, so a 403 is never a signal that a resource exists in another tenant

### `packages/api/src/contracts/money.test.ts`
- `toWireMoney` encodes amounts as decimal **strings**, round-trips through `Money.parse`, and respects each currency's own exponent (JPY exponent-0, BHD exponent-3) rather than assuming two decimal places
- A value beyond `Number.MAX_SAFE_INTEGER` crosses the boundary exactly — the concrete reason ADR 0002 chose `bigint`
- `toWireMoneyFromMinorUnits` handles zero and negative balances (legitimate for `external` accounts) and **throws** on a corrupt persisted currency rather than formatting at a guessed scale
- `decimalAmountSchema` rejects an empty string and a million-digit string, and accepts exactly at the cap — closing the Phase 2 deferral that `BigInt` parsing is superlinear in digit count

### `packages/api/src/contracts/cursor.test.ts`
- Cursors round-trip with millisecond fidelity, are URL-safe, and are opaque (the raw transaction id does not appear in the token)
- Ten malformed-input classes return `null` rather than throwing — bad base64, non-JSON, JSON scalars/arrays, missing or wrong-typed fields, empty string
- An unparseable date returns `null` specifically: `new Date("nonsense")` yields an Invalid Date rather than throwing, which Drizzle would render as SQL `NULL` and silently return an empty page instead of an error

### `packages/api/src/procedures.test.ts`
- The procedure ladder's rejection paths, all *before* any repository query runs: no session → `401`; signed in with no active organization → `403 no_active_organization`; signed in naming an org with no `member` row → `403 not_a_member`
- Naming a **nonexistent** organization returns a `403` identical to naming a real one the user does not belong to — so organizations are not enumerable either
- A genuine member is admitted, and the raw Better Auth role string in `member.role` actually reaches `toLedgerRole` (both `member` and `admin` rows are admitted to the read surface)

### `packages/api/src/routers/tenant-isolation.test.ts`
- Invariant #5 at the API boundary, across all seven read procedures with two fully-populated orgs whose accounts share identical names: `accounts.list`, `transactions.list`, `reconciliation.verify`, `audit.list`, and `audit.rejections` each return only the acting org's rows
- `accounts.get` and `transactions.get` report another org's real id with a `404` **byte-identical** to a missing id — same code, status, message, and data — and never echo the probed id back
- `transactions.get` never surfaces another org's postings
- **The forged-claim case:** a session naming an org the user is not a member of is rejected with `403 not_a_member` rather than reading that org's data — the specific failure that would occur if `activeOrganizationId` were trusted without the membership lookup
- No response body from any procedure contains `orgId`, though every repository row carries it

### `packages/api/src/routers/no-org-input.test.ts`
- ADR 0005 enforced mechanically: walks the real router, introspects the real Zod input schemas, and asserts none accepts `orgId`/`organizationId`/`tenantId`/`org`/`organization`
- Guards the guard — asserts the exact procedure count and that a known field (`accountId`) is actually readable, so a broken introspection fails loudly instead of passing vacuously over zero procedures

### `packages/api/src/routers/reads.test.ts`
- Balances, posting amounts, and reconciliation figures serialize as decimal strings; a whole response survives `JSON.stringify`, which would throw outright if a raw `bigint` leaked
- An `external` account's negative balance encodes correctly; timestamps are ISO-8601 strings
- Cursor pagination walks every row **exactly once** across pages with no duplicates — the test that caught the microsecond/millisecond precision bug fixed in `drizzle/0003_ledger_timestamp_millisecond_precision.sql`
- A malformed cursor is `400`, not a silent empty page; an out-of-range `limit` is rejected at the contract boundary
- `reconciliation.verify` reports agreeing recorded/computed balances after real postings and derives `allReconciled`
- A posted transfer appears in `audit.list` with the correct actor; an insufficient-funds rejection surfaces through `audit.rejections`, proving ADR 0003's separate-transaction rejection recording is visible from the read side

### `packages/api/src/http.test.ts`
- The status codes above actually reach the wire, through a real Hono app and oRPC's `OpenAPIHandler`: `200`, `401`, `403` (both reasons), `404`, and `400` for contract-validation failure
- A cross-org `404` and a missing-id `404` are byte-identical *as HTTP responses*, and the probed id appears nowhere in the body
- Phase 4b added the first wire-level `409` (duplicate account name), `422` (unbalanced transaction), `429` (write limit exhausted), and `403 insufficient_role` (viewer attempting a write) — until then those statuses were verified only by unit-testing `toORPCError` and by reading oRPC's status table
- Deliberately does **not** cover Better Auth: the app is assembled with a stub context, because the claim under test is oRPC's status translation rather than authentication. `apps/server`'s own `createContext` wiring is therefore not exercised here

### `packages/api/src/routers/approvals.test.ts` (Portfolio)
- Submitting a pending transfer does **not** move balances; the row appears in `listPending`
- Same idempotency key + same payload **replays** the pending row (`replayed: true`) without a duplicate
- The submitter is refused on approve/reject with `403 self_approve_forbidden`
- A second admin can approve (posts via `postTransaction`, clears the queue, updates balances) or reject (no posting, balances unchanged)
- A same-org `viewer` is refused on submit and approve (`403 insufficient_role`)
- `settings.get` / `settings.setRequireTransferApproval` round-trip the org flag (default `false`)

### `packages/api/src/routers/writes.test.ts`
- **Authorization** — a `viewer` is refused `403 insufficient_role` on all three write procedures. This is `adminProcedure`'s first real coverage: Phase 4a defined it but nothing used it, so only the pure `canWrite` predicate was tested. An `owner` is admitted, exercising the `owner → admin` mapping end to end
- `accounts.create` — zero starting balance, no `orgId` in the response; a duplicate name returns **`409 account_name_taken` rather than the unhandled 500 it produced before Phase 4b**; the same name is allowed in a *different* org, proving the constraint is `(org_id, name)` and not global; an unsupported currency is `422` rather than a guessed exponent
- `transactions.create` — a balanced transfer returns resulting balances; a 3-leg fee split posts correctly, which is the shape a transfer-only API could not express
- **Domain validation matrix**, each asserting the documented reason: single leg → `too_few_postings`; imbalance → `unbalanced_transaction`; mixed currency → `currency_mismatch`; zero amount → `non_positive_amount`; excess precision → `invalid_amount` (rejected, never rounded); a 100-character amount → `400` at the contract boundary, closing the Phase 2 `BigInt`-CPU deferral
- **Pre-persistence rejections are audited** — the validation failures above happen at `Transaction.create`, before `postTransaction` runs, so its own rejection path never sees them. Until Phase 4b they left no trace, contradicting `ledger.md` line 54
- **Funds and account state** — an overdraw of a `normal` account returns `422 insufficient_funds`, leaves the balance at zero, writes no transaction, and is audited; posting to a deactivated account returns `422 account_inactive` (the row is flipped via raw SQL, since no deactivate endpoint exists — which is exactly why the check lives under the row lock); an account belonging to another org returns `404`, **not** `422`, because `lockAccounts` checks existence for every id before activity for any, so a cross-org probe can never learn "inactive"
- **Idempotency** — same key + same payload replays the original with no second transaction; **same legs in a different order also replay**, which is the whole reason `requestHash` sorts; same key + different payload returns `409` and is audited; five concurrent calls on one key via `Promise.all` produce exactly one transaction id (invariant #4 through the API)
- `transactions.reverse` — mirrors and links via `reverses_transaction_id`, restoring both balances; the original's postings are byte-identical before and after (invariant #8); reversing a reversal is permitted and re-applies the original effect; **another org's transaction id returns `404` identical to a missing one** — without the org-scoped lookup this would reverse another tenant's transaction, since `ledger_transaction`'s self-FK is org-blind
- **Rate limiting** — exceeding the org limit returns `429` with `data.reason === "rate_limited"` and a positive `retryAfterSeconds`; one org exhausting its budget leaves another org unaffected (invariant #5 applied to availability, which keying by IP would have broken); a refused `viewer`'s attempts are not charged to anyone's budget, because the limiter runs *after* the role check

### `packages/api/src/sandbox/reset-plan.test.ts`
- Pure, no database — the chunking algebra is where reset's real risk lives (termination, balance, the conditional suspense leg) and all of it is decidable from balances alone
- **Direction** — a positive (net-debit) balance is cleared by a credit and a negative one by a debit; every emitted amount is strictly positive; accounts already at zero are skipped rather than turned into zero-amount postings
- **The chunk boundary** — at exactly 99 accounts the whole set is taken with no suspense leg; at 100 it splits and opens one, and the resulting 99 + 1 legs is exactly `MAX_POSTINGS`; a *partial* chunk that happens to sum to zero correctly gets no suspense leg either
- **Termination** — a 250-account ledger, a 100-account ledger, and a 10-account ledger are each driven to all-zero by looping the planner and applying each chunk, asserting every chunk nets to zero on the way. This is the property a per-transaction reversal model cannot provide
- **Currencies** — a chunk never spans two; currencies are taken in ascending ISO order; looping drains all of them
- **A broken ledger is not papered over** — balances that do not sum to zero produce an unbalanced chunk with no suspense leg, so `Transaction.create` refuses it (`422`) instead of a plug figure quietly repairing a reconciliation break
- **Chunk hashes** — stable for the same remaining work (so a resumed chunk replays), distinct between two chunks of one reset (so they cannot collide), and sensitive to amounts as well as account ids

### `packages/api/src/sandbox/scenarios.test.ts`
- Pure, no database — checks the seed set as data, so a malformed scenario fails here by name instead of surfacing as a confusing `422` from inside the handler
- Every scenario's legs **net to zero** — including the insufficient-funds one, which must be a *balanced* transaction or it would be refused at construction for the wrong reason and never reach the funds check at all
- Every leg names a declared account; account names are unique (`UNIQUE (org_id, name)`); every amount parses and is positive; the set is single-currency so no scenario can violate invariant #7
- The four scenarios `ledger.md`'s acceptance criteria name are present, funding runs first, exactly one scenario expects rejection, and exactly one reverses
- **Key derivation** — a reversing scenario gets two distinct keys (it posts two transactions, and one key for both would collide with itself as a `409`), every transaction the seed posts has a unique key, and two run keys never overlap

### `packages/api/src/routers/sandbox.test.ts`
- `sandbox.seed` — creates the declared accounts and posts every scenario; **reconciliation returns clean across all of them**, which is `ledger.md` line 80's stated acceptance bar; every balance in the org sums to zero (money is conserved)
- **The expected rejection is real** — the insufficient-funds scenario is reported as `rejected` with reason `insufficient_funds` and appears in `audit.rejections`, so the endpoint that reads rejections has genuine data to serve
- **Seed idempotency** — the same run key replays with no new transactions and identical balances; a different run key seeds an independent set; accounts are reused by name across runs rather than colliding on `UNIQUE (org_id, name)`
- `sandbox.reset` — a no-op on an untouched org; drives every balance to zero while leaving every account **`active`** (the property that keeps seed → reset → seed a loop rather than a one-way door); reconciliation stays clean; the transaction count *grows*, proving nothing was deleted; an ordinary sandbox finishes in one call and grows no suspense account
- **The case that rules out per-transaction reversal** — a `T1 → R1 → R2` history leaves the ledger at ±100 with every transaction either reversed or itself a reversal. Reset zeroes it anyway, because it reads balances rather than walking the reversal graph
- **Beyond one chunk** — a ledger past `RESET_CHUNK_SIZE` completes over multiple calls via the suspense path and ends at `remaining: 0`; exactly one suspense account is opened, it is `external`, and it finishes at zero; reconciliation stays clean throughout; two currencies both drain without a transaction ever spanning them
- **The loop** — seed → reset → seed → reset runs twice end to end, asserting the org is funded after each seed and unwound after each reset, with reconciliation clean at all four points
- **Permissions and tenancy** — a `viewer` in the same org is refused `403 insufficient_role` on both procedures; seeding and resetting one org leaves another org's accounts and transactions completely untouched

---

## `apps/web` — the console (Phase 5a)

Unit tests over the console's pure kernel. No database and no Docker. The `happy-dom` environment is configured now so later slices render into a working harness, but 5a itself renders nothing — `apps/web/src/routes/` and `src/components/` are untouched by this phase.

### `apps/web/src/lib/ledger/amount.test.ts`
- **The exponent is per-currency and never guessed** — one whole unit parses to `1n` (JPY), `100n` (USD), `1000n` (BHD). A hardcoded exponent of 2 passes every USD case in the file and silently misplaces the decimal point on the rest
- JPY `"12.50"` is rejected (exponent 0 admits no fraction digits); JPY `"1250"` is 1250 minor units, not 125000; BHD `"1.250"` is 1250
- USD `"12.505"` is rejected as **excess precision rather than rounded** — the console does not decide where a half-cent went (`ADR 0002`)
- For all ten currencies: an amount with exactly the permitted fraction digits parses, and one digit more is rejected
- Malformed input is rejected by class — `""`, whitespace, `"NaN"`, `"Infinity"`, `"1e5"`, `".5"`, `"5."`, `"1,000"`, `"$5"`, `"--5"`, `"5 5"` — and surrounding whitespace on a pasted value is trimmed rather than rejected
- Length is capped before the string reaches `BigInt`, mirroring the server's CPU-sink guard; `MAX_MINOR_UNITS` parses and one minor unit more is rejected as **out of range, distinguishably from malformed** — the server collapses both into `422 invalid_amount`, but they are different problems to someone typing
- `formatMinorUnits` renders zero at each currency's own scale (`0.00` / `0` / `0.000`), pads sub-unit amounts (`0.05`), keeps the sign on the negative balances `external` accounts legitimately hold, and **round-trips through `parseAmount` for every currency** across positive, negative, and large values
- An unknown currency renders as a raw integer plus code rather than a guessed scale — obviously-unformatted beats plausibly-wrong. `formatAmountWithCurrency` does **not** append the code a second time in that branch (regression: it produced `"1250 XXX XXX"`)

### `apps/web/src/lib/ledger/postings.test.ts`
- **Orientation, the failure the server cannot catch.** An unbalanced array returns `422 unbalanced_transaction`; a *balanced but inverted* one posts cleanly, moves money the wrong way, and produces no error anywhere. So orientation is pinned against the `funding` seed scenario **imported from `packages/api/src/sandbox/scenarios.ts`** — the payload the API's own integration suite posts against real Postgres — asserting the destination is debited and the source credited. Verified by mutation: inverting `composeTransfer` fails these tests while all 18 balance-only assertions still pass
- Swapping source and destination produces a **different** array, and the account debited in one is credited in the other
- The multi-leg posted scenarios (`payroll`, `marketplace_payout`) agree: the account money leaves carries the single credit
- `composeTransfer` scales to the currency, not to two decimal places — 1250 minor units is `"12.50"` USD, `"1250"` JPY, `"1.250"` BHD
- Rejects a non-positive amount and a transfer to the same account (which would net to zero against itself)
- `composeTransfer` rejects an unknown currency up front (regression). `formatMinorUnits` refuses to guess a scale and returns `"100 XXX"` — correct for display, but not a decimal string
- `assertBalanced` throws on an unbalanced array, on fewer than 2 or more than 100 legs, on legs spanning more than one currency, and on an amount that is not a decimal string
- **The false-pass regression** — `"1.0"` debit against `"10"` credit both reduce to the digits `10`. A scale-blind check cancels them and waves through a transfer moving nine units of real money. Legs are rescaled to a common width before summing, and legs written at different widths that genuinely agree (`"1.0"` / `"1.00"`) still pass

### `apps/web/src/lib/ledger/idempotency.test.ts`
- **A retry reuses the key byte-for-byte** — the single property that makes a retry a replay rather than a second posting (`ADR 0006:17`)
- Minting happens exactly once per operation: repeat calls write nothing further, so the function is safe to call from an effect React may run more than once
- A key **survives a reload** — a fresh store reading the same persisted slot resumes it, so refreshing mid-submit cannot create a second transaction
- Each operation kind holds its own slot, so two open forms cannot clobber each other; a reversal key is scoped to the transaction being reversed
- `newOperation` replaces the held key and becomes the new stable one; `completeOperation` releases only its own slot; `peekOperation` reads **without minting**
- **Importing the module is inert** — evaluating it touches `sessionStorage` zero times and calls `randomUUID` zero times. `vi.resetModules()` is load-bearing here: without it the static import has already run, the dynamic re-import returns the cache, and the assertion passes no matter what the module body does. A follow-up call proves the re-import evaluated a live module, so the check cannot pass vacuously
- `createSessionKeyStore` round-trips through the real `sessionStorage`, and **falls back to memory instead of throwing** when storage is unavailable — losing replay protection is bad, a console that cannot post at all is worse. Two independent callers on the fallback path get the **same** key (regression: a fresh memory map per call gave them different keys for one operation, reintroducing the double-post the module exists to prevent)

### `apps/web/src/lib/ledger/errors.test.ts`
- Copy exists for **all 17 published reasons**, and the set is checked against the literals actually present in **every non-test `.ts` file under `packages/api/src`**, walked recursively — so an 18th reason added upstream fails here by name instead of falling silently through to the generic fallback in production. The scan was originally three hand-picked top-level files and already missed `invalid_cursor`, which is emitted from `routers/transactions.ts`; the count is now pinned to the full published total so a *narrowing* of the scan is caught too. The repo root is located by walking up for `pnpm-workspace.yaml`, so the test passes from both `pnpm --filter web test` and a run started at the repo root
- **The server's `message` is never rendered** for any reason — it is a fixed operator-facing string and explicitly not a stable contract (`docs/backend/error-handling.md`)
- `account_not_found` and `transaction_not_found` say "not in this organization" and never "another organization" — the copy must not become an existence oracle for another tenant (`ADR 0005`)
- Failures the user can fix keep the form open, and so do transient ones — a `rate_limited` submit must not discard what the user typed. Only `blocked` and `reauthenticate` close it. `no_active_organization` and `not_a_member` route to re-authentication rather than an error screen (`docs/product/roles-and-permissions/ledger.md:70`)
- **The idempotency key is abandoned only on `409 idempotency_conflict`** — asserted across all 17 reasons. Critically not on `insufficient_funds`: a fresh key there would post twice
- `rate_limited` surfaces `scope`, `limit`, and `retryAfterSeconds` from the body (there is no `Retry-After` header, `ADR 0007`), and tolerates a body missing them
- The three no-reason branches each render distinctly: a bare `401`, a Zod `BAD_REQUEST` whose field issues are exposed for form binding, and an unmapped `500` that reveals no internals
- **Hostile input is renderable** — an unrecognised reason falls back without printing `undefined`; a network `TypeError`, `null`, `undefined`, a bare string, a number, an empty object, a string `data`, and a non-array `issues` all return copy rather than throwing inside the error handler; malformed issue entries are dropped rather than propagated

### `packages/api/src/auth/roles.test.ts`
- Maps Better Auth `owner`/`admin` → ledger `admin`, `member` → `viewer`; fails closed on unrecognised strings and on `null`/`undefined` (console affordance path)

### `apps/web/src/components/states/states.test.tsx` (Phase 5b)
- **The precedence rule, which is the reason this component exists.** A failed query has `data === undefined`, so an empty-first branch renders "nothing here yet" for a server that is down. Asserted directly: a failing query renders the error state and *not* the empty state, even when an `isEmpty` predicate is supplied that would match. In a ledger those states mean opposite things — one invites you to create an account, the other means the balances on screen may be nothing at all
- Empty renders only when the query genuinely succeeded with no rows; pending renders the skeleton and neither of the other two; settled-but-undefined is treated as an error rather than as empty
- The error state renders mapped copy and **never** the server's `message`; it is announced as `role="alert"`; its retry fires; a throttled response surfaces `retryAfterSeconds` from the body as a concrete wait
- Empty and error are distinguishable both by test id and by ARIA role — the empty state is not an alert
- The loading state carries `aria-busy` and a visually-hidden label rather than rendering silent boxes
- The empty state always carries a next action (the prop is required, not optional)

### `apps/web/src/features/accounts/account-display.test.tsx` (Phase 5c)
- Balances render **the wire string exactly**, at whatever scale the server sent — JPY as `1250` (not `1250.00`), BHD at three decimals, USD at two. The server has already formatted these with `Money.format()`; re-deriving client-side would create a second formatting path that could disagree
- **A negative `external` balance renders plainly, not as an error** — external accounts are expected to go negative, since that is what makes them the boundary money enters the sandbox through. A negative `normal` balance, which invariant #6 makes impossible, is flagged instead
- `isSuspenseAccount` recognises the accounts `sandbox.reset` opens on its own (`ADR 0008`) and does not mistake `Sandbox Funding`, or any `normal` account, for one

### `apps/web/src/features/accounts/field-errors.test.ts` (Phase 5c)
- **`409 account_name_taken` lands on the name field**, and `keepsFormOpen` is true — the case the create dialog is shaped around, since it is fixable by typing a different name and must not become a toast over a closed form
- `422 unsupported_currency` lands on the currency field; `400 {issues}` maps each issue's `path[0]` to its own field; issue paths that are not fields on this form (e.g. `orgId`) are ignored rather than rendered nowhere
- **Failures the form cannot fix attach to no field** — `insufficient_role` and `not_a_member` return `{}` and close the form; pinning them to an input would tell the user to edit their way out of a permissions problem
- A throttled submit attaches to no field but **keeps the form open**, carrying `retryAfterSeconds` from the body
- No branch surfaces the server's raw `message`

### `apps/web/src/features/transfer/submission.test.ts` (Phase 5d)
- **Orientation, re-asserted at the submission boundary** against the same `funding` scenario the 5a kernel is pinned to — the destination is debited, the source credited. Checked at both layers rather than once, because a balanced-but-inverted array is accepted by the server, moves money the wrong way, and produces no `data.reason` anywhere
- Swapping source and destination produces a different payload
- USD `"12.50"` sends `1250n`; JPY `"1250"` sends `1250`, not `125000`; JPY `"12.50"` is rejected as excess precision rather than rounded
- Every rejection carries **the field that caused it** — amount, source, or destination — so a message never floats free of the control it refers to. Covers empty, whitespace, non-numeric, exponential, negative, and zero amounts, plus missing source, missing destination, and same-account
- `describeTransfer` reads direction in plain language using account *names*, and reads differently when reversed

### `apps/web/src/features/transfer/eligibility.test.ts` (Phase 5d)
- Sources exclude closed accounts; destinations additionally exclude a different currency (invariant #7 — no FX in this sandbox) and the source itself, pre-empting `422 currency_mismatch` and `422 account_inactive` without removing either server branch
- An `external` destination is allowed — money leaving the sandbox is an ordinary transfer
- **`canTransfer` is false for two accounts in different currencies** — the case a naive `length >= 2` gets wrong. An org holding one USD and one JPY account has two accounts and can transfer nothing, so the empty state must not tell the user to create an account they already have

### `apps/web/src/features/transfer/transfer-form.test.tsx` (Phase 5d)
- **Exactly one idempotency key is minted under StrictMode's double-invoked effects.** React 19 runs effects twice in development; a key minted per effect or per render turns a retry into a second posting, and nothing upstream dedupes it because the server's request hash deliberately excludes the key (ADR 0006). **Verified by mutation:** swapping `startOperation` for `newOperation` fails this test and only this test — the payload, orientation, and balance assertions all still pass, which is exactly why counting mints is a separate test
- A `422` leaves the key in place so resubmitting is a replay under one key (ADR 0004); a successful post releases the slot so the next transfer is a new operation; the persisted key is the one actually sent
- The payload debits the destination and credits the source
- The confirmation step names the direction in plain language and posts **nothing** until confirmed
- `409 idempotency_conflict` triggers exactly one attempt, never an automatic retry, and offers an explicit start-over that mints a different key

### `apps/web/src/features/transactions/postings-table.test.tsx` (Phase 5d)
- The **net-to-zero proof** renders for a balanced transaction and says "Does not balance" loudly when it is not — unreachable from real data, so if it ever renders it is a reconciliation alarm and must not be quiet
- Sums are `BigInt` over digit strings, never `Number`. Legs are rescaled to a common width first: `"1.0"` against `"10"` must *not* balance (the same false-pass trap fixed in the 5a kernel), while `"1.0"` against `"1.00"` must
- A zero-exponent currency sums without inventing decimals
- Account names render when known, with the id as a fallback rather than a blank cell

### `apps/web/src/features/transactions/pagination.test.ts` (Phase 5e)
- **The cursor is carried verbatim** — asserted against a realistic base64url token. Trimming, re-encoding, or appending anything would either be rejected by the server or, worse, decode to an `Invalid Date` and return a *silently empty page* rather than an error
- A forward walk visits each page once: no skips, no repeats, page number derived from the walk
- `nextCursor === null` does not advance — the control is disabled, and this makes a stray click harmless too
- Back-navigation pops a client-held stack (the API is forward-only: no `prevCursor`, no total, no `hasPrevious`), returns to the exact prior page, walks all the way to page one, and is a no-op there rather than underflowing
- **`resetToFirstPage` discards the whole walk, not one step** — on `400 invalid_cursor` the entire sequence is stale, so popping once would just hand back another cursor the server will also reject

### `apps/web/src/features/transactions/reverse-dialog.test.tsx` (Phase 5e)
- **The payload is exactly `{transactionId, idempotencyKey}`** — asserted by key set, with an explicit check that no `postings` key is present. The server rebuilds the mirrored legs from persisted rows precisely so there is nothing for a caller to tamper with
- Confirmation friction: the action is disabled until the word `REVERSE` is typed, and is **case-sensitive** so it cannot be done by reflex; dismissing fires no mutation
- **The dialog states that reversals are not deduplicated** rather than implying a check it cannot perform. `reversesTransactionId` is a forward pointer — the API records that a transaction *is* a reversal, never that one *has been* reversed (open question #3)
- The idempotency key is scoped per transaction, so reversing A and reversing B cannot collide as a false `409`; the slot is released after success
- Exactly one attempt on failure — a reversal moves money and is never retried automatically — and the server's raw `message` is never rendered

### `apps/web/src/features/sandbox/reset-loop.test.ts` (Phase 5f)
- **Termination is exact.** Fed the protocol's `{99,150} → {99,51} → {51,0}` the loop issues **three** calls and no fourth — a fourth would post compensating entries against an already-zeroed ledger. An already-clean org terminates in one call as a no-op
- **The same run key on every call.** Reset is idempotent per key, so a retried chunk replays rather than double-compensating; minting mid-loop would re-post work already applied
- Progress is cumulative across chunks, not just the last response, and transaction ids accumulate
- **A mid-loop `429` pauses for `retryAfterSeconds` and resumes** under the same key, retaining prior progress — chunks are charged against 60/min/org and 30/min/user, so a large ledger can throttle its own loop. Falls back to a default pause when the body omits the field
- **`422 unbalanced_transaction` halts as a distinct `unbalanced` outcome**, not a generic failure — `ADR 0008` has reset refuse rather than destroy evidence, so it is a reconciliation alarm. Mid-loop, it retains the progress made before halting
- Any other failure, including a transport error with no reason, halts after exactly one attempt rather than looping
- A `maxCalls` backstop stops a server that never reduces `remaining`, and reports failure rather than silently claiming success — the ledger is partially unwound and someone needs to know

### `apps/web/src/features/reconciliation/drift.test.ts` (Phase 5f)
- Drift is zero when an account reconciles, signed positive when the recorded balance overstates the postings and negative when it understates — the direction is the diagnosis, not just the alarm
- Correct at all three exponent scales, and for the negative balances external accounts legitimately hold
- **Balances are padded to a common width before subtracting** — `"1.0"` against `"10"` must not read as agreeing (the same false-pass trap fixed in the 5a kernel and the postings table), while `"1.0"` against `"1.00"` must
- `formatDrift` signs the output, renders no sign for zero, and pads a sub-unit drift rather than dropping the leading zero

### `apps/web/src/features/sandbox/scenario-outcomes.test.tsx` (Phase 5f)
- **An expected refusal renders distinctly from both a success and a failure.** The seed set deliberately includes a transfer the ledger must reject — it demonstrates invariant #6 and gives the rejections log real data — so rendering it in red would report the suite as broken when it is working exactly as designed
- An *unexpected* rejection still shows its reason unsoftened; a posted scenario is never classified as a rejection
- The panel states that re-running appends another rejection entry each time (`ADR 0008`)
- A scenario that posted nothing renders a dash rather than a broken transaction link

### `apps/web/src/features/audit/entry-display.test.ts` (Phase 5g)
- **`actionLabel` falls back to the raw identifier** for an action this console has never seen. `action` is `z.string()`, not an enum, so a `switch` with no default would blank exactly the novel entries worth reading
- **Prototype-chain hazard, found by this test.** The lookup was an object literal, so `labels["__proto__"]` returned `Object.prototype` and `labels["toString"]` a function — neither `undefined`, so the fallback never fired and the cell rendered `[object Object]`. Now a `Map`, which has no prototype chain. `packages/core`'s currency parser guards the same hazard with `Object.hasOwn`
- `formatMetadata` handles `null`/`undefined` (returning `null`, not the string `"null"`), primitives, arrays, and nested objects; **survives a circular structure**, which would otherwise make `JSON.stringify` throw inside a table cell and take down the whole log; returns `null` rather than the string `"undefined"` for a function or symbol
- `isExpectedRefusal` recognises the sandbox's intended refusal so repeated identical rows do not read as repeated bugs, without softening a genuine failure or misclassifying a posted entry

### `packages/api/src/procedures.test.ts` — `protectedProcedure` (updated Phase 5h)
- The 401 rejection is asserted through a **test-local protected-only router**, not a production procedure. `privateData` was `protectedProcedure`'s only consumer and was removed in 5h; the coverage could not move to a real procedure because every remaining one sits on `orgProcedure`/`adminProcedure`, which compose `requireAuth` **and** `requireOrg` — and `requireOrg` re-checks the session itself, so such a test would still pass with `requireAuth` deleted outright
- A companion case asserts the same fixture **serves** a signed-in caller, so a fixture failing for any unrelated reason cannot satisfy the 401 assertion and look like working coverage

### `packages/api/src/routers/reads.test.ts` — amounts and reversals on the read surface (extended Phase 6b)
- **`transactions.list` returns every posting on every row**, so a history table can show what moved. Before 6b it returned `transactionSchema` — id, currency, actor, timestamp, reversal marker, and no amounts
- **A 3-leg split keeps all three legs.** This is the test that would fail if someone collapsed postings into a scalar `amount` field; a balanced transaction may have any number of legs, so no single "amount" exists to return
- **Query count is constant in page size** — a 6-row page issues the same number of queries as a 2-row page. Counted by wrapping `pool.query`, *not* by listening for a `query` event: `pg.Pool` emits no such event, so a listener-based counter would have recorded 0 for both and passed vacuously. Caught by `tsc`, not at runtime. The test also asserts the count is `> 0`, so a wrapper that stops intercepting fails instead of passing silently
- **`reversedBy` is `[]` for an unreversed transaction**, and names the reversal on both `list` and `get`
- **A transaction reversed twice reports both reversal ids.** The assertion that forces `reversedBy` to be a list rather than a boolean. It funds the account first, and that is load-bearing: each reversal re-debits the wallet, so reversing a credit twice against an unfunded account is refused for `insufficient_funds` by invariant #6 — double reversal is *possible but not always affordable*, which is exactly why it cannot be a schema-level flag

### `packages/api/src/routers/writes.test.ts` — append-only under a derived field (updated Phase 6b)
- The append-only assertion compares the whole response **minus `reversedBy`**, so a newly added *stored* column is still covered automatically rather than being silently exempted by a field-by-field rewrite
- `reversedBy` is then asserted to go from `[]` to `[reversal.id]` — excluded from the equality but not from the test. It changing is the correct consequence of *appending* a reversal, the opposite of a mutation: nothing on the original row or its postings is rewritten

### `apps/web/src/features/transactions/total.test.ts` (Phase 6b)
- **Sums every debit leg of a split**, not just the first — the case a scalar wire `amount` could not have represented
- **Counts debits only**, so a balanced transaction is not double-counted
- **`0.10 + 0.20 === 0.30` exactly**, because the sum is `bigint` minor units. In binary floating point it is not (ADR 0002)
- **Zero-exponent currencies** (JPY) render with no decimal point, rather than inheriting a two-decimal assumption
- **Returns `null`, never a partial sum**, when a leg will not parse, when debit legs disagree on currency, or for an unknown currency code. A total that silently drops an unreadable leg would understate what moved while looking authoritative — so the table renders an explicit dash, which is a different claim from `0.00`

### `apps/web/src/features/transactions/reverse-dialog.test.tsx` — already-reversed warning (extended Phase 6b)
- **States plainly that the transaction was already reversed**, and counts them when there is more than one. Before 6b this dialog could only disclose its own blindness: *"this console cannot tell whether this transaction has already been reversed"*
- **Warns but does not block.** The API does not deduplicate reversals, so the console must not pretend to — reversing again still fires exactly one mutation
- The pre-existing *"reversals are not deduplicated"* assertion is **kept**, not deleted: `reversedBy` removed the blindness but changed nothing about the API

### `apps/web/e2e/` — end-to-end (Phase 6c, Playwright)

Run with `pnpm test:e2e`. Requires Postgres up (`pnpm db:start`) and migrated; Playwright starts the API and web servers itself. Chromium only. Each spec creates a uniquely-named user and org, so files are order-independent and no database reset is needed — **verified by running the suite twice in a row against the same database, 3/3 both times.**

- `onboarding.e2e.ts` — an unauthenticated visitor hitting `/accounts` lands on `/login`, not a half-rendered console. A new user signs up, is routed to `/organization` (a session with no active org is a *normal* state per `roles-and-permissions/ledger.md`, not an error), creates one, and reaches the console with org-scoped nav present. The intermediate redirect is asserted, not waited out, so a change that dropped the user elsewhere fails loudly
- `accounts.e2e.ts` — a new org's accounts screen shows the **empty** state and *not* the error state. On a ledger these mean opposite things: one invites you to create an account, the other means the figures on screen may be nothing at all

**What e2e does NOT cover — stated plainly, because partial coverage reported as complete is worse than none:**

- **Account creation, transfer, and reversal through the browser.** Specs for all three were written and run during 6c, then **removed**. The account-type and account pickers are Base UI `Select` components whose listbox stays mounted after selection; the resulting specs passed on one run and failed on the next against unchanged code. A test that gives different answers for identical code teaches people to re-run until green, which is worse than an honest gap. These flows stay covered by the `apps/web` component suite (mocked client) and the `packages/api` integration suite (real database) — what is missing is browser-level proof that the two halves meet
- **Viewer-role behaviour.** Every spec acts as an org admin
- **Reconciliation, sandbox, and audit screens**
- **CI.** There is no e2e job. It has only ever been proven locally, and adding CI config that has never run in CI is the sort of unverified check Phase 6a existed to remove

The numbered **manual demo scripts** in the archived Phase 5 task files are therefore *not* retired — they remain the record for everything above.

### `packages/api/src/routers/pagination.test.ts` — cursor paging on the four reads that gained it (Phase 7a)

Closes open questions #6 and #7. `transactions.list` was already paginated and stays covered in `reads.test.ts`.

- **Every walk visits every row exactly once** — accounts, the audit log, and reconciliation, at a page size of 2 or 3. Asserted as both a length and a `Set` size, so a duplicate is caught as well as a gap. The walk helper is bounded at 50 pages and *throws* rather than looping: a cursor that fails to advance is a hang otherwise, and a hanging test is far worse to diagnose than a failing one
- **`reconciliation.verify` reports `allReconciled: false` when the only drifting account is outside the first page.** The load-bearing test of the whole slice. It asserts page one is *genuinely clean* and the verdict is *still false* — a page-local fold over those two clean rows would return `true`, so the "guard the guard" assertion is what makes this test meaningful rather than incidentally passing
- **`accountCount` and `unreconciledCount` are identical at `limit: 1` and `limit: 200`**, proving the counts are whole-org aggregates and not derived from the rows returned
- **A posting-less account with a drifted balance is caught, not excused.** `coalesce(computed, 0) <> recorded` matters: `NULL <> 0` is `NULL`, which `count(*) filter` does not count, so the naive comparison would silently exempt exactly the accounts most likely to be wrong
- **All five paginated procedures reject a malformed cursor with the same `400 invalid_cursor`**, never an empty page. Asserted as a table across every endpoint, because the console keys its "that page link expired" recovery off that exact reason string — a procedure that spelled it differently would silently render an empty list, telling someone their ledger is empty when it is not
- **The rejections tab pages independently of the full log.** A cursor from the unfiltered log applied to the filtered view would skip rejections
- **Drift is injected with raw SQL**, deliberately: there is no way to break invariant #2 through the ledger's own write path, which is the point of the invariant, so it has to be done at the storage layer or it cannot be tested at all

### `packages/api/src/contracts/cursor.test.ts` — generalized codec (updated Phase 7a)
- The cursor now carries a **sort key** rather than a timestamp, since accounts and reconciliation page on `(name, id)` while transactions and audit page on `(created_at, id)`
- **A name cursor round-trips through JSON + base64url with quotes, slashes, and non-ASCII intact.** A mangled key resumes the walk from the wrong row
- **The length cap is checked against the worst case** — a 120-character account name, not a timestamp. If `MAX_CURSOR_LENGTH` ever stopped covering it, every account page past the first would fail with `invalid_cursor`
- **A legacy `{c,i}` token decodes to `null`.** Cursors are opaque and short-lived so the field rename is not a breaking change, but it has to fail *loudly* as an invalid cursor — which every screen recovers from — rather than decode to something wrong
- **The Invalid Date guard is scoped to the time cursor only.** The same token is a legitimate *name* cursor, and conflating the two would reject valid account pages

### `packages/api/src/routers/sandbox.test.ts` — assertions kept as strong under pagination (updated Phase 7a)
- Five assertions that read *all* accounts now **walk pages**. One of them was failing outright; the more instructive one was **passing while checking 50 of 105 balances**. Any assertion about a total, a count, or the *absence* of something cannot be made from a single page — "no suspense account on page one" is not "no suspense account"

### `packages/api/src/routers/dashboard.test.ts` — the overview aggregate (Phase 7b)

- **Money is conserved per currency**: `normalTotal + externalTotal === 0n` across a multi-currency, multi-leg, partly-reversed org. Every transaction is balanced and single-currency, so summing balances across *all* accounts in a currency sums every signed posting in it — a sum of zeroes. If this fails, either the aggregate is wrong or the ledger is
- **A 4-leg payroll run counts as one transaction, and its debits sum once.** Joining postings multiplies each transaction row by its leg count: a plain `count(*)` would report four. `count(distinct)` fixes the count while leaving the `sum` correct — the two aggregates want opposite things from the same join, and both have to be right
- **Debits only.** A balanced transaction's credits are equal and opposite, so summing both directions would always yield zero and summing all legs regardless of direction would double what moved
- **Query count is constant** between a small org and one with 9 accounts, 9 transactions, and a second currency. If a per-account or per-currency lookup is reintroduced, cost grows with the data on the landing screen and this fails
- **An empty org returns zeroed totals and empty arrays** — not `null`, `NaN`, or an error. An aggregate over no rows is exactly where a `sum` comes back `NULL` and a mapper mishandles it
- **A refused transfer counts as a rejection and appears in no other figure.** It writes no transaction and no posting, so leaking it into volume would be a false claim that money moved
- **Tenant isolation**, asserted in both directions: this org sees zeroes while the other org sees its own two accounts, so the assertion is about scoping rather than about an empty database

### `apps/web/src/features/dashboard/summary.test.ts` — chart series construction (Phase 7b)

- **Days with no activity are zero-filled, not omitted.** The server returns rows only for days that had activity; plotting those directly would sit a one-day gap beside a three-day gap and read as continuous. The x-axis is a timeline, so silence occupies its slot
- **Days are built in UTC.** Two instants on the same UTC date produce the same window. Local-time getters would shift every bar by a day for any user east or west of UTC against a server grouping by `date_trunc` on a timestamp — activity on the wrong day, not merely a differently-labelled axis
- **Counts sum across currencies; amounts never do.** The count series is asserted to carry `0n` for `minorUnits`, so nothing can start adding USD to EUR to make a taller bar
- **`0.10 + 0.20 === 30n`** exactly, because volume is summed as `bigint` minor units (ADR 0002)
- **`dailyVolume` returns `null`, never a partial series**, when an amount will not parse or the currency code is unknown. A chart drawn from the days that happened to parse would understate what moved while looking authoritative
- **`barHeightPercent` is exact past float precision** (`9_007_199_254_740_993n`), clamps to `100` so a bar cannot overflow its plot, and returns `0` for a zero, negative, or degenerate scale rather than throwing or inventing one
- **`isConserved` has three states.** `null` when a total will not parse — claiming "not conserved" there would raise a false alarm about the ledger's integrity, and claiming "conserved" would suppress a real one

**Charts are not unit-tested for rendering.** They were verified by running the app: a seeded org with transactions spread across the window, screenshotted in both themes. That pass caught two real defects a unit test would not have — a stretched `viewBox` rendering bars wider than their 24px cap with elliptical corners (fixed by moving from SVG to CSS bars), and absolutely-positioned gridlines painting *over* the marks instead of behind them (fixed with explicit `z-0`/`z-10`).

### `packages/core/src/money/exchange.test.ts` — exchange-rate arithmetic (Phase 7c)

- **A rate is held exactly** as an integer numerator plus a scale, and the caller's own text survives so what gets stored is what was agreed rather than a re-rendering that might normalise `"0.9200"` to `"0.92"`
- **Zero and negative rates are refused.** Zero converts every amount to nothing; a negative would produce a negative target amount that `createPosting` rejects far from the actual mistake
- **Half-up rounding happens exactly once, at the target scale.** 33.33 USD at 0.92 is 30.6636 EUR → `30.66`
- **Scale differences are folded into the same fraction**, not applied as a second rounding pass. 1 JPY (exponent 0) at 0.0025 into BHD (exponent 3) is `0.003`; rounding the ×1000 shift separately would give `0.002` or `0.000`
- **Exact at `9_007_199_254_740_993`** — the first integer a double cannot represent
- **`checkConversion` returns the expected amount on failure**, not a bare boolean, so a form can say "expected 92.00" instead of "invalid conversion". Tolerance is *zero*: off by one minor unit is refused, because "close enough" on a ledger is how a cent per transaction goes missing

### `packages/api/src/routers/exchange.test.ts` — cross-currency exchange end to end (Phase 7c)

- **Both legs post, each balanced in its own currency**, and the FX position lands on `FX Bridge USD` (+100.00) and `FX Bridge EUR` (−92.00). The bridges are `external`, because the target-side one is credited and so goes negative — which invariant #6 forbids for a `normal` account
- **Every account still reconciles, and each currency still sums to zero.** This is the payoff of the two-transaction design: reconciliation needed no modification at all
- **Bridges are opened once**, however many exchanges run
- **The legs are linked and the rate lives on the target only** — `fxSourceTransactionId` stored, `fxTargetTransactionId` derived as its inverse, `fxRate` on the target. Putting the rate on both would invite a reader to apply it twice
- **Atomicity: nothing posts when anything fails.** Insufficient funds, an unknown account, and a cross-org account each leave balances untouched, write no transaction of *either* currency, and leave reconciliation clean. A half-completed exchange would strand money in a bridge with nothing to say where it was going
- **One key covers both legs.** A repeat replays both and moves balances once; the same key with a *different rate* is a `409`, because the same two amounts are reachable from more than one rate within a rounding band and replaying would silently discard the new rate; the same key in the opposite *direction* is also a `409`, which is why the two legs are hashed in source-then-target order rather than sorted
- **Every refusal is audited** with a matching `reason` and the `post_exchange` action
- **A viewer is refused** `403`

### `apps/web/src/features/exchange/conversion.test.ts` — the console's side (Phase 7c)

- **The previewed figure is the one submitted**, computed with `packages/core`'s own `convert`. A browser copy of the rounding rule would agree for most inputs and disagree for exactly the awkward ones, producing a form that submits a value the server rejects with no way to tell which side is wrong
- **Excess precision and non-positive rates are refused**, matching the server
- **Eligibility is the mirror of the transfer screen's** — an exchange needs the currencies to *differ* where a transfer needs them to match, so `canExchange` and `canTransfer` disagree on the same org and each empty state says the true thing
- **FX bridge accounts are excluded from both pickers.** They are plumbing opened automatically to hold the position; exchanging directly into one would work and mean nothing
- **`isFxBridge` matches the server's naming and nothing near it** — `"FX Bridgehead"` and `"My FX Bridge USD"` are not bridges

**Not unit-tested:** the exchange form's rendering. It was verified by driving the real app — pickers, conversion preview, post, source leg, FX link, target leg — which caught two things unit tests would not have: both money-moving forms displayed the account's raw **uuid** in the picker trigger (Base UI's `Select.Value` renders the bare value unless handed a function), and the transaction detail page never surfaced the FX link at all.

### Portfolio showcase track (2026-08-01)

### `apps/web/src/features/transactions/postings-table.test.tsx` (extended)
- Debit/credit columns plus totals row and journal integrity badge

### `apps/web/src/lib/export/csv.test.ts`
- CSV cells with commas/quotes are escaped for client-side History/Audit export

### `apps/web/e2e/walkthrough.e2e.ts`
- Seed → scenario outcomes → integrity seal visible (demo spine)

### `packages/api/src/routers/writes.test.ts` — replayed flag (2026-08-01)
- Fresh `transactions.create` returns `replayed: false`; same key+payload returns `replayed: true` without a second row

### `packages/api/src/routers/reads.test.ts` — history filters (2026-08-01)
- `accountId`, `kind`, and debit-total `minAmount`/`maxAmount` filter in SQL
- Cursor pagination under `accountId` walks without duplicates or under-fill

### `apps/web/src/features/accounts/statement-sparkline.test.ts` (Portfolio)
- Running-balance points collapse to a daily series for the statement sparkline

### `apps/web/src/lib/org/session.test.tsx` — org-switch cache hygiene (2026-08-15)
- A query that stays **mounted** through `switchOrganization` (the sidebar integrity seal's situation) refetches and renders the new org's data — the regression that motivated this file: `queryClient.clear()` removes queries but never refetches actively-observed ones, so the seal kept showing the previous org's "Verified · N accounts" until a full reload
- A query that is **not** mounted during the switch holds no data from the previous organization afterwards (ADR 0005's isolation applied to the client cache)

### API hardening phase (2026-08-16)

### `apps/server/src/app.test.ts` — the first tests `apps/server` has ever had
Until this file, `apps/server` had no test and no Vitest config: `src/index.ts` called `serve()` at module scope, so importing anything from it started a real listener. The app now lives in `src/app.ts`, separate from the process that serves it, which is what makes the composition assertable rather than mirrored — `packages/api/src/http.test.ts` builds its own lookalike app, and its docblock already recorded that `apps/server`'s own composition was uncovered.

- Security headers on the JSON surface: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, and `X-Powered-By` removed
- HSTS is **absent** outside production — the header claims "HTTPS only" and this server is plain http locally
- CSP is `default-src 'none'` (plus `frame-ancestors`/`base-uri`/`form-action`, none of which inherit) on everything but `/api-reference`
- `/api-reference` gets exactly its jsDelivr + inline-script relaxation, and the relaxation does **not** follow the page off its own path
- Liveness `/` answers 200 **against an unreachable database** — proving it has no dependency, which is why the probes are registered before the oRPC catch-all that resolves a session
- `/ready` returns 503 when Postgres is gone, and its body leaks no host, user, or credential
- A body over the 1 MB cap is refused with 413 before parsing
- Log redaction, asserted against the exact paths the real logger is built with: session cookie, `Authorization`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, and — the one that is not obvious — **a failed query's bound parameters**, since `DrizzleQueryError` exposes `query`/`params` as own enumerable properties and pino's default `err` serializer emits every one of them, so Better Auth's bound session tokens and password hashes were reaching the log

**Not covered:** signal handling. `SIGTERM`/`SIGINT` drain and pool close are process-level, and this suite tests the app, not the listener — asserting them would mean forking a real process per case. Recorded rather than faked.

### Server-side maker-checker (2026-08-16)

### `packages/api/src/routers/approvals.test.ts` (extended)
- A direct `transactions.create` is refused `403 approval_required` when the org requires approval, no balance moves, and the attempt appears in `audit.rejections` — the bypass was previously invisible because the flag lived in a React component
- `transactions.exchange` is refused the same way: `ledger_pending_transfer` holds one balanced posting set and an exchange posts two linked transactions, so there is no approval route and it fails closed rather than becoming the way around the control
- With the flag **off**, a direct post is unchanged — the gate must be inert by default
- **`approvals.approve` still posts while the flag is on.** The load-bearing one: approve reaches the ledger through `postTransaction`, not through the gated wire procedure. If it is ever refactored to route through `transactions.create`, this test fails instead of the org silently losing the ability to approve anything
- Approving the same pending transfer twice in sequence yields **one** transaction — the console minted `crypto.randomUUID()` per click, so a double-click used to post twice
- Two admins approving concurrently yield **one** transaction and one balance movement; the `status !== "pending"` check cannot catch this because both read before either writes, so the guarantee comes from the idempotency key being derived from `pending.id`

<!-- add one block per test file, keep in sync with what actually exists -->

