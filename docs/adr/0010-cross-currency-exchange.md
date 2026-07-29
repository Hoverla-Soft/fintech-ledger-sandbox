# ADR 0010 — Cross-currency exchange as two linked transactions

**Status:** Accepted · **Date:** 2026-07-29 · **Phase:** 7c

## Context

`docs/product/requirements/ledger.md` put FX out of scope, and the domain was built accordingly: `Transaction.create` requires every posting to share one currency (invariant #7), `ledger_transaction.currency` is a single `NOT NULL` column, and `reconcileAccounts` groups by the account's own currency. Adding cross-currency movement means deciding where the second currency lives.

Two candidate models were on the table.

## Decision

**A cross-currency transfer is two single-currency transactions, committed together, linked by a self-FK, with the agreed rate recorded on the target leg.**

A USD→EUR exchange of 100.00 at 0.92:

```
T1 (USD)   credit  Alice USD       100.00      balanced in USD
           debit   FX Bridge USD   100.00

T2 (EUR)   credit  FX Bridge EUR    92.00      balanced in EUR
           debit   Bob EUR          92.00

T2.fx_source_transaction_id = T1.id
T2.fx_rate = "0.92"
```

The rate comes from the caller and so does the resulting amount; the server verifies they agree and refuses the write otherwise.

## Why not one multi-currency transaction

Relaxing the invariant from "one currency" to "balanced per currency" was the alternative. It was rejected because of what it costs elsewhere:

- `Transaction.create`'s currency-agreement check disappears, and `CurrencyMismatch` stops meaning what it means today.
- `ledger_transaction.currency` stops being single-valued — a migration with no honest backfill for a column that was `NOT NULL`.
- Reconciliation, the wire contracts, the history table's currency column, and every currency test need review.
- **The FX position has nowhere to live.** 100.00 USD did not *become* 92.00 EUR by arithmetic; someone took the other side. In a single transaction, the difference is a rounding artefact with no account behind it. In the two-transaction model, it sits openly as `+100.00` on `FX Bridge USD` and `-92.00` on `FX Bridge EUR` — which is what an FX position *is*.

By contrast, the chosen model changed **nothing** already built. Reconciliation needed no modification at all, and per-currency conservation still holds: each leg nets to zero inside its own currency, so the sum of all balances in a currency is still zero. The dashboard's conservation check went on passing without being touched.

## Consequences

**The bridge accounts are `external` and auto-opened.** External because the target-side bridge is credited and therefore goes negative, which invariant #6 forbids for a `normal` account — and because a bridge genuinely is where money leaves the org's own books. Auto-opened on first use, following the precedent ADR 0008 set for `Sandbox Suspense <CUR>`; the create-then-look-up ordering resolves the concurrent first exchange without a racy pre-check.

**One idempotency key covers both legs, and the fingerprint includes the rate.** A leg is not independently replayable. The key backfills to the source leg and a replay walks forward through the FX link. The rate is part of the hash because the same two amounts are reachable from more than one rate within a rounding band, so reusing a key with a different agreed rate is a *different request* and must conflict rather than silently replay the old rate.

**The lock set is the union of both legs, taken once.** `lockAccounts` sorts ids so concurrent transfers cannot deadlock. Two sequential per-leg locks would break that: a USD→EUR exchange takes `{payer, bridge USD}` then `{bridge EUR, payee}` while a concurrent EUR→USD exchange takes them in the opposite order. Locking the union up front restores one global ordering.

**The caller declares the converted amount; the server verifies it.** A conversion rarely lands on a whole minor unit — 33.33 USD at 0.92 is 30.6636 EUR. ADR 0002's rule is that this ledger never silently reinterprets a figure a person typed, so the rounding decision is the caller's to state and the server's to check. `convert` computes one canonical answer (half-up, at the target currency's scale, in one integer divide) and a mismatch is refused with the expected figure in `data.expected` so a form can show what it should have been. The console computes the same value with the same `core` function, so the happy path always agrees.

**A rate is a decimal string, never a float**, parsed into an integer numerator plus a scale. A rate held as a float turns every conversion into an approximation whose error scales with the amount — ADR 0002's hazard with a longer lever.

**`fx_source_transaction_id` is UNIQUE (partial).** This is what lets the read side expose a *scalar* counterpart id. The contrast with `reversedBy` is deliberate: a transaction may be reversed any number of times, so that field is a list; an exchange source has exactly one target, and the constraint makes the scalar structurally true rather than merely conventional.

## What this does not do

- **No market data.** The sandbox has no rate source and does not want one; the rate is whatever the caller states. A provider integration was considered and rejected as out of proportion to a fake-money sandbox — it would add a dependency, a network boundary, and non-deterministic tests.
- **No FX gain/loss recognition.** The bridge accounts accumulate positions; nothing revalues them or books a P&L. That is a real accounting feature and would be its own slice.
- **No same-currency "exchange".** Refused with `422 same_currency_exchange`; that is an ordinary transfer.
- **Reversing one leg of an exchange reverses only that leg.** `transactions.reverse` is unchanged and knows nothing about FX links, so reversing the USD half leaves the EUR half standing. Recorded as a known limitation in `docs/open-questions.md` rather than papered over.
