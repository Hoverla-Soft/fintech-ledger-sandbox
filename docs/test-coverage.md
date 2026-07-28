# Test coverage

---

## Framework & setup

| Item | Value |
|---|---|
| Framework | Vitest 4 |
| Test location | `packages/core/src/**/*.test.ts` (unit), `packages/db/src/**/*.test.ts` (integration), `packages/api/src/**/*.test.ts` (unit + integration) |
| Test type | `packages/core`: unit (no database). `packages/db` and `packages/api`: integration — real Postgres via Testcontainers, requires a reachable Docker daemon (see `docs/development/testing-rules.md`). `packages/api` additionally holds pure unit files (role mapping, error map, wire codecs) that need no database but share the suite's container lifecycle |

## Running tests

```bash
pnpm test          # all tests (turbo runs each package's `test` task)
pnpm --filter @fintech-ledger-sandbox/core test   # core suite only
pnpm --filter @fintech-ledger-sandbox/core test:watch
pnpm --filter @fintech-ledger-sandbox/db test     # db suite only — needs Docker
pnpm --filter @fintech-ledger-sandbox/api test    # api suite only — needs Docker
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

<!-- add one block per test file, keep in sync with what actually exists -->
