# Test coverage

---

## Framework & setup

| Item | Value |
|---|---|
| Framework | Vitest 4 |
| Test location | `packages/core/src/**/*.test.ts` |
| Test type | unit (no database) |

## Running tests

```bash
pnpm test          # all tests (turbo runs each package's `test` task)
pnpm --filter @fintech-ledger-sandbox/core test   # core suite only
pnpm --filter @fintech-ledger-sandbox/core test:watch
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

<!-- add one block per test file, keep in sync with what actually exists -->
