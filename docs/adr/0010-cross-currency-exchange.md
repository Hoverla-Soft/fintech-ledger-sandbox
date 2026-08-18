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
- ~~**Reversing one leg of an exchange reverses only that leg.**~~ **Closed 2026-08-18 — see the amendment below.**

## Amended 2026-08-18 — reversing either leg unwinds the pair

This ADR shipped with "reversing one leg of an exchange reverses only that leg" above, recorded as open question #20 rather than papered over: reversing the USD half restored the payer while the converted EUR stayed with the payee and the EUR bridge stayed short — money simultaneously on the books and unreachable.

It is closed, and the shape of the fix is this ADR's own argument repeating itself. **An unwind has the identical shape to the exchange it undoes**, so `postExchange` grew one optional field — the id each leg reverses — and nothing else moved. Naming either leg posts both mirrors in one commit, under one idempotency key, with the union of both legs' accounts locked once. The pair is itself fx-linked, `R2.fx_source_transaction_id = R1.id`, carrying the originals' direction and rate:

```
T1 (USD) ──fx──▶ T2 (EUR)      the exchange
 │                │
 reversedBy       reversedBy
 ▼                ▼
R1 (USD) ──fx──▶ R2 (EUR)      the unwind
```

Four things follow, and each is why the pair is linked rather than left as two transactions that happen to share a commit.

**The published contract did not change.** `transactions.reverse` still returns one `postedTransactionSchema` — the mirror of the leg the caller named — and that transaction's own `fxSourceTransactionId` / `fxTargetTransactionId` names its counterpart. A response describing one transaction while two were posted would have been the dishonest half of this design; instead the answer is complete without a new output type, a new procedure, or a new error code. The alternative considered was a separate `transactions.reverseExchange` plus a new `422` refusing single-leg reversal, which costs a wire type, a frontend error-vocabulary entry, a second confirmation path in the console, and breaks the existing Reverse button on every FX transaction — all to state what the link already states.

**The idempotency replay path needed nothing.** `loadPostedExchange` finds the second leg by the FX link. An unlinked pair would have needed its own reload, walking mirror → original → fx counterpart → its mirror.

**The rate on the unwind is the original's, not its inverse.** It is not the rate of a new conversion; it is the rate this pair unwinds, and it relates R1's 100.00 USD to R2's 92.00 EUR by exactly the arithmetic `convert` already performed. `1/0.92` is a figure nobody agreed to and is not exactly representable.

**The fingerprint had to grow, and this was not predicted.** `computeExchangeRequestHash` covered `(source legs, target legs, rate)` — nothing about *which* exchange is being unwound. Two identical exchanges produce byte-identical mirror legs, so a key spent unwinding one would have replayed against the other and reported success while the second stayed standing. That is verbatim the failure ADR 0006 puts `reversesTransactionId` in the single-transaction hash to prevent; it simply could not arise here until an exchange could itself be a reversal. The two reversed ids are now in the payload, **omitted entirely when absent** so every exchange hash already stored keeps hashing to what it hashed to before — the un-versioned canonical format ADR 0006 records as a standing hazard.

### What an unwind refuses

**An unaffordable counterpart refuses the whole thing.** If the payee has spent the converted funds, the second mirror rejects with `insufficient_funds` and the entire unwind rolls back, including the leg that would have succeeded. An exchange whose proceeds are gone cannot be undone, and failing must not leave the half-state this amendment removes.

**A leg already reversed is refused with `409 already_reversed`**, from `ledger_transaction_reversesTransactionId_idx` rather than from a handler pre-check, which would be racy for the reason ADR 0006 gives.

**One case routes to the single-leg path, and getting its condition wrong was the bug the tests caught.** When the counterpart already carries a reversal *and the named leg does not* — a genuinely half-reversed exchange, from data written before this behaviour or a leg reversed through `packages/db` directly — the named leg is reversed alone, because the pair path would hit that unique index, roll back, and strand the survivor permanently. The first implementation checked only the counterpart, which also matched a pair this endpoint had *already* unwound: both legs carry a reversal then, so an honest replay of the unwind was routed down the single-transaction path under a different fingerprint and came back as a false `409 idempotency_conflict`. When both legs are reversed there is nothing left to complete, so the pair path is correct — the same key replays and a fresh one is refused as `already_reversed`.
