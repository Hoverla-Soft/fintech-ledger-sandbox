# Requirements: Double-entry ledger (payments-style, multi-tenant)

The product spec for the fintech ledger sandbox. This is the durable source of truth for *what* the ledger does and the invariants it must always hold. Phase task files (`docs/tasks/*.md`) implement slices of this and link back here.

## Summary

A payments-style, double-entry ledger. Money never appears or disappears: every economic event is a **transaction** made of ≥2 **postings** (debits/credits) that net to zero. Accounts hold a materialized balance derived from — and always reconcilable with — an append-only posting history. Multi-tenant: every account, transaction, and posting belongs to an **organization** and is invisible to every other org. "Sandbox" = fake money, safe to seed and reset.

*Contract note (Phase 4c):* "reset" means **the money is unwound**, not that the data is erased. Postings are append-only and the database refuses to delete them (invariant #8), so reset posts a balanced compensating transaction that drives every balance to zero and leaves the accounts in place, active, ready to be seeded again. History grows; it never shrinks. See `docs/adr/0008-sandbox-reset.md`.

## Ubiquitous language

- **Organization (org / tenant):** isolation boundary. Owns accounts. Users belong to orgs via Better Auth's organization plugin.
- **Account:** a named balance within an org, in a single ISO-4217 **currency**, with a **type**: `normal` (may never go negative) or `external` (a liability/funding account representing money entering/leaving the sandbox; may go negative).
- **Posting:** one leg of a transaction against one account — a `direction` (`debit`/`credit`) and a positive **amount** in integer minor units. Append-only, never mutated or deleted.
- **Transaction:** an atomic, balanced set of ≥2 postings. Sum of debits == sum of credits, all in the same currency. The common case is a 2-posting transfer; fees/splits are N-posting.
- **Balance:** an account's current amount, materialized on the account row, always equal to the signed sum of its postings (**reconciliation invariant**).
- **Reversal:** a new transaction that mirrors a prior one (debits↔credits), linked via `reverses_transaction_id`. The only way to "undo" — history is never edited.
- **Idempotency key:** a client-supplied token that makes transaction creation safe to retry — the same key yields exactly one transaction.

## Invariants (the correctness spec — these are the tests)

1. **Money is conserved** — every transaction's postings net to zero.
2. **Balances reconcile** — `signed Σ(postings) == account.balance` for every account, always.
3. **Atomicity** — a transaction fully posts (all postings + all balance updates) or not at all.
4. **Idempotency** — one idempotency key ⇒ exactly one transaction, even under concurrent retries (DB-enforced).
5. **No cross-tenant leakage** — no read or write ever crosses an org boundary.
6. **Sufficient funds** — a `normal` account may never go negative; checked inside the row lock.
7. **Currency match** — all postings in a transaction share one currency; a transfer across mismatched-currency accounts is rejected.
8. **Immutable history** — postings are append-only; corrections are reversing transactions.

## Actors

- **Org admin** — creates accounts, posts transactions, issues reversals, seeds/resets the sandbox.
- **Org viewer** — read-only: balances, transactions, postings, reconciliation, audit log.
- **System** — reconciliation verification; rejection recording.

## Permissions

Roles come from Better Auth (org-scoped): `admin` (all writes + reads within its org), `viewer` (reads within its org). No actor can act outside its org. See `docs/product/roles-and-permissions/`.

## Entry points

- API: oRPC procedures under `/rpc` (typed) with an OpenAPI reference at `/api-reference`.
- Web: the console (`apps/web`) — accounts, transfer flow, postings inspector, reconciliation, audit log, seed/reset.

## Happy path (post a transfer)

1. Admin submits a transfer (source, destination, amount, currency, idempotency key; optional extra legs for fees/splits).
   - *API contract note (Phase 4b):* the line above describes the user-facing submission, which the console (Phase 5) composes. The API itself takes a **balanced postings array** plus an idempotency key, not a transfer shape — it maps 1:1 onto `Transaction.create`, and a `{source, destination, amount}` shape would make the published `too_few_postings` and `unbalanced_transaction` rejections structurally unreachable. See `docs/adr/0006-write-endpoint-contract.md`.
2. Domain builds a balanced `Transaction` — rejects at construction if legs don't net to zero or currencies differ.
3. In one DB transaction: lock the involved accounts (ordered), check funds on `normal` sources, insert postings, update balances, persist the idempotency key + an audit entry.
4. Return the created transaction with resulting balances.

## Error paths

- **Unbalanced / currency mismatch / non-positive amount / <2 legs** → rejected at domain construction → `422`; recorded as a rejection with reason.
- **Insufficient funds** on a `normal` account → `422` (reason `insufficient_funds`); recorded; no postings written.
- **Unknown/inactive account, or account in another org** → `404`/`403`; never reveals another org's data.
- **Idempotency key reused with a different payload** → `409 Conflict`; same key + same payload → original result replayed, no second posting.
- **Concurrent duplicate keys** → DB uniqueness collides; exactly one wins.

## Backend (API — Phase 4)

- Endpoints (oRPC): create account, list/get accounts + balances, create transaction (transfer/N-leg), reverse transaction, list transactions/postings (cursor-paginated), reconciliation verify, audit log, rejections, seed/reset.
- **Validation:** Zod at the contract boundary; domain invariants enforced in `packages/core`, not the handler.
- **Error responses:** typed oRPC errors mapping to `422`/`403`/`404`/`409`; every rejection persisted.
- **Side effects:** postings inserted, balances updated, idempotency key stored, audit entry written; nothing else.
- Write endpoints are rate-limited.

## Frontend (console — Phase 5)

- **Loading:** skeletons on every fetch.
- **Empty:** distinct empty states (no accounts yet, no transactions yet) with a next action.
- **Error:** distinct from empty; failed loads show a retry; failed mutations keep the form open with the reason inline.
- **Navigation:** after a successful transfer → transaction detail / updated balances; after cancel → back to list; drawers/modals close only after the request resolves.
- **Feedback:** toast on success, inline reason on validation/insufficient-funds failure.

## Acceptance criteria

- All 8 invariants have passing automated tests, including cross-tenant-isolation and idempotency-under-concurrency.
- Reconciliation verify returns clean across all seed scenarios (payroll run, marketplace payout with fees, insufficient-funds rejection, reversal).
  - *Implementation note (Phase 4c):* these ship as `sandbox.seed`, which also posts a preliminary **funding** scenario — money has to enter the sandbox through an `external` account before any of the four can move it. Verified by `packages/api/src/routers/sandbox.test.ts`.
- CI green through `/feature-loop` (typecheck, test, build, all guards).

## Out of scope (v1)

- ~~**FX / multi-currency conversion**~~ — **delivered in Phase 7c**, and the way it was delivered kept this row's underlying rule intact. An account is still single-currency and a *transaction* is still single-currency: a cross-currency move is **two** linked single-currency transactions committed together (`transactions.exchange`, `docs/adr/0010-cross-currency-exchange.md`), so invariant #7 is unchanged and nothing here was relaxed. Still out of scope: any **rate source** (the caller states the rate), **FX gain/loss recognition** on the bridge positions, and reversing an exchange as a single unit — see open questions #20–#23.
- **Holds / authorizations** (auth→capture→void, available vs posted balance) — Phase 2 of the product; schema kept extension-ready.
- Interest, fees schedules, statements, reconciliation against external banks, real payment rails, KYC/regulatory.

## Spec completeness

### Common
- [x] Actor(s) defined
- [x] Entry point defined
- [x] Preconditions described (org context + role; see Permissions/Preconditions)
- [x] Happy path described
- [x] Error paths described
- [x] Permissions considered
- [x] Acceptance criteria written
- [x] Tests defined (the invariants + scenarios)
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined
- [x] Validation described
- [x] Error responses defined
- [x] Side effects listed

### Frontend
- [x] Loading state defined
- [x] Empty state defined
- [x] Error state defined
- [x] Navigation after each action defined
- [x] Feedback defined
