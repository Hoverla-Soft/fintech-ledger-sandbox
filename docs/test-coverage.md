# Test coverage

---

## Framework & setup

| Item | Value |
|---|---|
| Framework | Vitest 4 |
| Test location | `packages/core/src/**/*.test.ts` (unit), `packages/db/src/**/*.test.ts` (integration) |
| Test type | `packages/core`: unit (no database). `packages/db`: integration — real Postgres via Testcontainers, requires a reachable Docker daemon (see `docs/development/testing-rules.md`) |

## Running tests

```bash
pnpm test          # all tests (turbo runs each package's `test` task)
pnpm --filter @fintech-ledger-sandbox/core test   # core suite only
pnpm --filter @fintech-ledger-sandbox/core test:watch
pnpm --filter @fintech-ledger-sandbox/db test     # db suite only — needs Docker
```

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

<!-- add one block per test file, keep in sync with what actually exists -->
