# Task: Cross-currency exchange

## Goal

An organization can move money between accounts in different currencies, at a rate it states, without weakening any invariant the ledger already holds.

A cross-currency transfer is **two linked single-currency transactions committed together** — not one multi-currency transaction. `Transaction` keeps its single-currency rule, reconciliation is untouched, per-currency conservation still holds, and the FX position lands openly on a pair of `external` bridge accounts instead of vanishing into a rounding difference. Both design decisions were put to the user and confirmed before implementation; the reasoning is recorded in `docs/adr/0010-cross-currency-exchange.md`.

The rate and the converted amount both come from the caller. The server recomputes the conversion and refuses a mismatch, returning the figure it expected. This is ADR 0002's rule applied to FX: the ledger never silently reinterprets a number a person typed, so the rounding decision is stated rather than assumed.

## Status

Human Review

Verified 2026-07-29: `pnpm lint` (0 errors), `pnpm check-types` (6/6), `pnpm test` (core 90, db 28, api 291, web 317 — 726 total), `pnpm build` (2/2). Migration `0005` applied to a dev database holding existing rows, and the whole flow driven in a real browser: pickers → conversion preview → post → source leg → FX link → target leg.

## Scope (allowed paths)

- `packages/core/src/money/exchange.ts`
- `packages/core/src/money/exchange.test.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/index.ts`
- `packages/db/src/schema/ledger.ts`
- `packages/db/drizzle/**`
- `packages/db/src/posting/post-transaction.ts`
- `packages/db/src/posting/index.ts`
- `packages/db/src/repositories/accounts.ts`
- `packages/db/src/repositories/transactions.ts`
- `packages/api/src/routers/transactions.ts`
- `packages/api/src/routers/exchange.test.ts`
- `packages/api/src/routers/no-org-input.test.ts`
- `packages/api/src/contracts/wire.ts`
- `packages/api/src/contracts/request-hash.ts`
- `packages/api/src/errors.ts`
- `apps/web/package.json`
- `apps/web/src/features/exchange/**`
- `apps/web/src/routes/_auth/exchange.tsx`
- `apps/web/src/routes/_auth/transactions/$transactionId.tsx`
- `apps/web/src/components/shell/nav.ts`
- `apps/web/src/lib/ledger/errors.ts`
- `apps/web/src/lib/ledger/errors.test.ts`
- `apps/web/src/lib/ledger/idempotency.ts`
- `apps/web/src/features/transfer/transfer-form.tsx`
- `docs/adr/0010-cross-currency-exchange.md`
- `docs/adr/README.md`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/product/requirements/ledger.md`

## Out of scope

- **Market data / an FX provider integration.** The rate is caller-supplied. A provider adapter was considered and rejected as out of proportion to a fake-money sandbox — it would add a dependency, a network boundary, and non-deterministic tests.
- **FX gain/loss recognition.** The bridge accounts accumulate positions; nothing revalues them or books a P&L.
- **Reversing an exchange as a unit.** `transactions.reverse` is unchanged and knows nothing about FX links, so reversing one leg leaves the other standing. Recorded as an open question rather than half-solved.
- **Relaxing `Transaction`'s single-currency invariant.** Explicitly rejected — see the ADR.
- **The paginated reads and the dashboard aggregate.** Phases 7a and 7b, already done.

### Scope additions made during the task, and why

- **`apps/web/src/features/transfer/transfer-form.tsx`** — the browser pass found that both account pickers displayed the account's raw **uuid** instead of its name, because Base UI's `Select.Value` renders the bare value unless handed a function. Pre-existing, and inherited by the new exchange form. On the two screens that move money the trigger is the one place someone can confirm they picked the account they meant, so it was fixed in both rather than only in the new one. No behaviour change beyond the label.
- **`apps/web/src/lib/ledger/errors.ts` + its test** — three new server reasons (`invalid_rate`, `conversion_mismatch`, `same_currency_exchange`) need console copy, and `errors.test.ts` correctly failed until they had it. The existing `currency_mismatch` copy also said "this sandbox does not convert between currencies", which is no longer true; it now points at Exchange.
- **`apps/web/package.json`** — `@fintech-ledger-sandbox/core` added as a direct dependency so the console can run the *same* `convert` the server verifies with. The alternative was a second implementation of conversion rounding in the browser, which is precisely the drift `lib/ledger/amount.ts` exists to avoid.

## Related docs

- `docs/adr/0010-cross-currency-exchange.md` — this decision in full
- `docs/adr/0002-money-representation.md` — why a rate is a decimal string and every conversion is integer arithmetic
- `docs/adr/0004-idempotency.md` — one key for both legs; the rate is part of the fingerprint
- `docs/adr/0008-sandbox-reset.md` — the auto-opened-account precedent the FX bridges follow
- `docs/product/requirements/ledger.md` — invariants #1, #2, #6, #7

## External sources

- Task/issue: N/A: no external tracker configured (open question #12)
- Product documentation: N/A: local only
- Design: N/A: no design source configured

## Acceptance criteria

- `transactions.exchange` posts two transactions in one commit: the source balanced in the source currency, the target balanced in the target currency.
- Every account still reconciles afterwards, and each currency's balances still sum to zero.
- The FX position is visible as `FX Bridge <CUR>` balances — `+amount` on the source side, `-targetAmount` on the target.
- Bridge accounts are `external`, opened on first use, and opened exactly once however many exchanges run.
- The legs are linked: `fxSourceTransactionId` stored on the target, the inverse `fxTargetTransactionId` derived on the source, and `fxRate` on the target only.
- A target amount that is not the canonical conversion is refused with `422 conversion_mismatch` **and the expected figure**, so a form can show what it should have been.
- A rate that is zero, negative, malformed, or over-precise is refused.
- Two same-currency accounts are refused with `422 same_currency_exchange`.
- Nothing is posted when any part fails — insufficient funds, an unknown account, a cross-org account. Asserted on balances, on the transaction list, and on reconciliation.
- One idempotency key covers both legs: a repeat replays both and posts nothing twice; the same key with a different rate, or a different direction, is a `409`.
- Every refusal is recorded in the audit log with a matching reason.
- A viewer is refused with `403`.
- Conversion is exact across differing currency scales (USD↔JPY, JPY↔BHD) and rounds half-up exactly once.
- The console has an Exchange screen whose on-screen converted figure is the exact value submitted.
- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Task files are working records. When this task reaches `Done`, `Cancelled`, or `Superseded`, move it from `docs/tasks/` to `docs/tasks/archive/2026/`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — an org `admin`. Viewers are refused, like every other write
- [x] Entry point defined — the `/exchange` console screen; and `transactions.exchange` directly
- [x] Preconditions described — an active org, a verified `member` row mapping to `admin`, and two active accounts in different currencies. Bridge accounts are *not* a precondition: they are opened on demand
- [x] Happy path described — pick two accounts, state an amount and a rate, confirm the previewed conversion, post; land on the source leg, which links to the target
- [x] Error paths described — `422` for `conversion_mismatch` (with the expected amount), `invalid_rate`, `same_currency_exchange`, `insufficient_funds`, `account_inactive`, `invalid_amount`; `404` for an unknown or cross-org account; `409` for an idempotency conflict; `403` for a viewer. Every one leaves the ledger untouched and is audited
- [x] Permissions considered — `adminProcedure`; org derived from the `member` row, never from input (ADR 0005)
- [x] Acceptance criteria written
- [x] Tests defined — 19 API integration cases, 17 core unit cases for the rate arithmetic, 20 console cases for the preview and eligibility
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `transactions.exchange`, input and output enumerated above
- [x] Validation described — amounts by `parseBoundedAmount` at each account's own currency; the rate by `Rate.parse` (positive, ≤10 dp, length-bounded before `BigInt`); the conversion by `checkConversion`; currencies read from the accounts, never accepted as input
- [x] Error responses defined — see Error paths
- [x] Side effects listed — two `ledger_transaction` rows, four `ledger_posting` rows, up to two `ledger_account` inserts (bridges), four balance updates, one idempotency row, two "posted" audit rows; or one "rejected" audit row and nothing else

### Frontend
- [x] Loading state defined — `QueryState` skeleton for the account list; the submit button reads "Posting…" and every control disables
- [x] Empty state defined — "Nothing to exchange between yet" when the org lacks two active accounts in different currencies, which is a different test from the transfer screen's
- [x] Error state defined — server failures render inline with title and detail, distinct from the empty state; `409` offers an explicit "start over with a new key"
- [x] Navigation after each action defined — success navigates to the source leg's detail page, which links on to the target; failures stay on the form with the key intact so a retry replays
- [x] Feedback (toast/inline/modal) defined — a success toast plus navigation; inline `role="alert"` for failures; a live-region conversion preview

---

*Started 2026-07-29.*
