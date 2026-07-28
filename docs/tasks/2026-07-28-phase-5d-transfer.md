# Task: Phase 5d — transfer and transaction detail

## Goal

Compose a balanced postings array from a human transfer intent, post it **exactly once**, and land on a real destination.

This is the slice the whole phase was ordered around. ADR 0006 made the console responsible for building the postings array — *"composing it, including balancing the legs, is now the console's job, not the API's"* (`docs/adr/0006-write-endpoint-contract.md`) — which means this is the first screen that can cause a wrong money movement rather than merely display one.

Transaction detail ships **in this slice**, not later, because `docs/product/requirements/ledger.md:76` makes it the post-transfer navigation target. Building the transfer first and the destination afterwards would mean shipping a throwaway landing page.

## Status

Human Review

## Scope (allowed paths)

**`apps/web` — the screens:**

- `apps/web/src/routes/_auth/transfer.tsx`
- `apps/web/src/routes/_auth/transactions/$transactionId.tsx`
- `apps/web/src/features/transfer/**`
- `apps/web/src/features/transactions/**`
- `apps/web/src/components/shell/**`
- `apps/web/src/routeTree.gen.ts`

**Documentation:**

- `docs/frontend/forms-and-validation.md`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-5d-transfer.md`

## Out of scope

- **`apps/web/src/lib/ledger/**`.** 5a's kernel is closed and is *consumed* here, not edited. `composeTransfer`, `assertBalanced`, `parseAmount`, and the idempotency module are used exactly as they ship. If a defect is found in one, stop and re-scope — that is CLAUDE.md rule 3's intended signal, not an obstacle.
- **Transaction history and reversal.** 5e. This slice adds transaction *detail*, reachable by direct link after a post; the paginated list and the reverse action are the next slice.
- **N-leg splits in the UI.** `composeLegs` exists in the kernel and is tested, but the form here composes the 2-leg transfer case only. A fee-split builder is a separate design problem and would double this slice.
- **New `packages/ui` primitives.** Everything needed (`dialog`, `select`, `field`, `table`, `badge`, `separator`, `alert`) landed in 5b/5c.

## Related docs

- `docs/adr/0006-write-endpoint-contract.md`
- `docs/adr/0004-idempotency.md`
- `docs/adr/0002-money-representation.md`
- `docs/frontend/forms-and-validation.md`
- `docs/frontend/ui-states.md`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — the idempotency key is minted when the form opens, never on submit and never in render.** `apps/web/src/lib/ledger/idempotency.ts` (5a) already enforces this; this slice must *use* it correctly. The failure it prevents: a retry under a fresh key posts the transfer twice, and nothing upstream dedupes it, because the request hash deliberately excludes `idempotencyKey` (`packages/api/src/contracts/request-hash.ts`). The vectors are concrete — React 19 StrictMode double-invoke, TanStack Query mutation retry, and minting inside a render pass.

**D2 — `retry: false` on this mutation, explicitly, even though 5b's default already sets it.** Stated at the call site as well as the client default, because the cost of that default being changed later by someone who has not read ADR 0006 is a double-posted payroll. Belt and braces is proportionate here and nowhere else.

**D3 — a plain-language confirmation names source → destination → amount before submitting.** This is the mitigation for the phase's worst failure mode: a *balanced but inverted* postings array. Swap the debit and the credit and the array still nets to zero, `transactions.create` still succeeds, the postings still persist, balances still reconcile — the money simply moved the wrong way, and there is no `data.reason` for it because from the server's view nothing is wrong. 5a pinned the orientation with a fixture derived from the `funding` scenario; this is the second line of defence, and it is a human one.

**D4 — the pickers pre-empt `currency_mismatch` and `account_inactive`, and both branches are wired anyway.** The destination list is filtered to accounts sharing the source's currency, and both lists to `active` accounts. That is a better experience than a round trip to a `422`. But the account list is cached and can be stale — an account can be closed between the fetch and the submit — so both server branches are implemented and tested regardless.

**D5 — `409 idempotency_conflict` requires explicit intent to start over, and never auto-retries.** The key has already been spent on a *different* payload, so no retry under it can succeed. The console offers a "start a new transfer" action that calls `newOperation`, and says plainly that nothing was posted just now. A silent re-mint here is exactly the double-post D1 exists to prevent.

**D6 — balances on the detail and success views are labelled "current", never "as posted".** `postedTransactionSchema.balances` is *current as of the response*: a fresh post computes them inside its own transaction, while an idempotent replay re-reads them live, so a retry can legitimately return the same `transactionId` and the same immutable postings alongside **different** balances. The API's own schema description says so. The console must not present them as a snapshot, and must not diff a replay against a cached original — there is no `replayed` flag to distinguish the two (open question #4).

## Design

### The transfer flow

1. Form opens → `startOperation("transfer")` mints and persists the key.
2. User picks source, destination, and types an amount.
3. `parseAmount(decimal, currency)` → `bigint` minor units, or a typed rejection rendered inline.
4. `composeTransfer({ source, destination, minorUnits, currency })` → a two-leg array, destination debited and source credited.
5. `assertBalanced(postings)` immediately before send — the last line of defence, re-deriving the sum from the array actually being transmitted.
6. Confirmation step (D3), then `transactions.create` with the persisted key.
7. Success → invalidate `accounts.list`, clear the key slot, navigate to detail.

### Failure branches, all rendered inline with the form open

`insufficient_funds`, `invalid_amount`, `non_positive_amount`, `too_few_postings`, `unbalanced_transaction`, `currency_mismatch`, `unsupported_currency`, `account_inactive`, `account_not_found`, `rate_limited`, and `400 {issues}`.

`too_few_postings` and `unbalanced_transaction` should be structurally unreachable through this form — the kernel guarantees two balanced legs — but they are published reasons and are wired, because "unreachable" is a claim about code that can change.

`409 idempotency_conflict` and `403 insufficient_role` close the form (D5, and the form cannot fix a role).

### Transaction detail

Renders the postings in `created_at ASC` order with a visible **net-to-zero proof** — the sum of debits and credits shown adding to zero, which is the reconciliation invariant made legible rather than asserted. Balances are labelled "current" (D6). A `404` reads as "not in this organization", never as "no access" (`ADR 0005`).

## Acceptance criteria

- A 2-leg USD transfer of `"12.50"` produces exactly one debit and one credit of `1250n` **on the correct accounts** — destination debited, source credited, matching the `funding` fixture orientation.
- A JPY transfer of `"1250"` sends `1250`, not `125000`.
- The idempotency key is byte-identical across a retry of the same intent; a `422` leaves it in place so resubmission is a replay; a `409` clears it only via an explicit user action.
- `retry: false` is set on the mutation, and a StrictMode double-render mints exactly one key.
- Submit is disabled for the entire in-flight window; the confirmation cannot be double-fired.
- A `422 insufficient_funds` leaves the form mounted, populated, and resubmittable under the same key.
- The destination picker excludes accounts whose currency differs from the source's, and both pickers exclude inactive accounts — while `currency_mismatch` and `account_inactive` remain implemented and tested.
- Transaction detail renders postings oldest-first with a net-to-zero proof, and labels balances "current".
- A replayed `200` renders no "changed" warning.
- `accounts.list` is invalidated after a successful post.
- A transfer nav link exists in the shell.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5c: `check-types` 6/6, `test` 473 passed (73 core + 140 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `check-types` **6/6 green** · `build` **2/2 green** · `test` **519 passed** (73 core + **186 web** + 28 db + 232 api) · migration guard **PASS**. `pnpm lint` — `N/A`. Backend suites untouched; the +46 are all `apps/web`.

**Idempotency proven by mutation, not just by assertion.** `startOperation` was swapped for `newOperation` in the form's mount effect and the suite re-run: exactly the StrictMode single-mint test failed, and the other six passed. That is the point — a re-minting bug is invisible to every assertion about payload shape, orientation, or balance, and only a test that counts mints catches it.

**Manual demo** (requires `pnpm db:start` and `pnpm dev`):
1. Seed or create two USD accounts, fund one.
2. Transfer `12.50` → confirmation names source, destination, and amount → post → land on detail showing two postings netting to zero.
3. Check both account balances moved in the expected direction.
4. Attempt a transfer larger than the source balance → `insufficient_funds` inline, form still populated, nothing posted.
5. Resubmit unchanged after fixing the amount → one transaction, not two.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and **delete `.claude/.active-task-scope.json`**.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org admin posts; viewers cannot (the form is hidden, and `403 insufficient_role` is handled regardless).
- [x] Entry point defined — `/transfer` via the shell nav; `/transactions/$transactionId` as the post-transfer destination.
- [x] Preconditions described — a verified active org, and at least two active accounts sharing a currency.
- [x] Happy path described — the seven-step flow above.
- [x] Error paths described — the full inline branch list, plus the two that close the form.
- [x] Permissions considered — admin-only write; role is an affordance hint only (ADR 0009).
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: no procedure is added or changed. Consumes `transactions.create`, `transactions.get`, and `accounts.list` as published.
- [x] Validation described — amounts through 5a's `parseAmount` (which delegates to the server's own parser); legs through `composeTransfer` + `assertBalanced`; the server remains the arbiter.
- [x] Error responses defined — the branch table above, all via `describeFailure`.
- [x] Side effects listed — postings inserted, balances updated, idempotency key stored, audit entry written. All server-side; the console additionally writes one `sessionStorage` key per operation.

### Frontend
- [x] Loading state defined — skeletons on the account pickers and on transaction detail.
- [x] Empty state defined — fewer than two eligible accounts renders a next action (create or seed) rather than an unusable form.
- [x] Error state defined — distinct from empty, with retry, on both screens.
- [x] Navigation after each action defined — success → transaction detail; cancel → back with nothing written; `409` → explicit start-over.
- [x] Feedback defined — toast on success; inline reason for every fixable and transient failure; toast for role and conflict.

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it.*

*Phase 5 slice 4 of 8. Predecessors: 5a, 5b, 5c (all Done). Successors: 5e history + reversal · 5f reconciliation + sandbox · 5g audit · 5h retire `privateData`.*
