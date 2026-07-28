# 0008 — Sandbox seed and reset

**Status:** Accepted (Phase 4c)

## Context

`docs/product/requirements/ledger.md` line 7 defines the product in one clause — *"'Sandbox' = fake money, safe to seed and reset"* — and line 63 lists seed/reset among the oRPC endpoints. Neither says what "reset" means, and the schema makes the obvious reading impossible.

ADR 0003 enforces invariant #8 with two triggers on `ledger_posting`: a row-level one against `UPDATE`/`DELETE` and a statement-level one against `TRUNCATE`, the second added specifically so a `TRUNCATE … CASCADE` from `organization` could not wipe append-only history. So a reset that *removes* the ledger is not merely discouraged; it is refused by the database. Any design that deletes has to first punch a hole in the mechanism that enforces a stated invariant.

ADR 0005 also left an open consequence pointed directly at this phase: a seed routine talking to `packages/db` outside the API would hold an `org_id` no middleware had vouched for, and it named Phase 4c as the first such caller.

## Decision

**Reset is a compensating entry, not a deletion and not a reversal of each transaction.** It reads every account with a non-zero balance, groups them by currency, and posts one balanced transaction whose legs are the opposite of each balance.

The reversal-per-transaction alternative is the intuitive one and it does not work, because ADR 0006 deliberately permits reversing a reversal. Given `T1`, its reversal `R1`, and `R2` reversing `R1`, the ledger sits at `T1`'s effect while every transaction is either already reversed or is itself a reversal:

- *"reverse everything un-reversed that is not itself a reversal"* selects nothing, so reset silently leaves the balances standing;
- *"reverse anything un-reversed"* selects `R2`, posts `R3`, then finds `R3` un-reversed and posts `R4` — oscillating forever.

No simple predicate over the reversal graph escapes both failures. The compensating entry never consults the history at all, so it is correct whatever shape that history has. It needs no plug figure either: every transaction nets to zero, so within one currency the signed sum of all balances is already zero, and legs of `-balance` therefore also sum to zero. Every `normal` account lands on exactly zero without passing through a negative balance, so invariant #6 needs no special case.

Invariant #8 and both triggers are left untouched. Reset is an ordinary domain write.

**Reset leaves accounts alive, active, and at zero.** Deactivating them is a one-way door: `ledger_account` has `UNIQUE (org_id, name)` and ADR 0006's inactive-account check refuses postings to a deactivated account, so a later seed could neither reuse those accounts (`422 account_inactive`) nor recreate them (`409 account_name_taken`). An organization could be reset exactly once and never seeded again. Leaving them active is what makes seed → reset → seed a loop rather than a cliff, and it means this phase ships no account-reactivation surface it was not asked for.

**Reset is bounded per call and resumable.** One call clears at most 99 accounts — `MAX_POSTINGS` is 100, leaving exactly one slot for a suspense leg — and returns `{ accountsZeroed, remaining }`; the caller loops until `remaining` is zero. When a currency holds more non-zero accounts than one chunk, each partial chunk carries an extra leg against a per-currency `Sandbox Suspense` account that absorbs the chunk's imbalance, and the final chunk clears the suspense account itself. That account is `external` (it is routinely negative mid-run, which invariant #6 forbids for a `normal` account) and is created **only when chunking actually requires it**, so an ordinary sandbox never grows one.

**A suspense leg is emitted only on a partial chunk, never on a final one.** This is the load-bearing half of the previous paragraph. On a final chunk the balances must already sum to zero; emitting a suspense leg there would absorb any discrepancy and quietly repair a broken reconciliation. Omitting it means an unbalanced set reaches `Transaction.create` and is refused as `422 unbalanced_transaction`. Reset is the tool reached for when a sandbox looks wrong, so it must not destroy the evidence of invariant #2 having been violated.

**Seed takes a caller-supplied run key; each scenario derives its own beneath it.** Same body-carried key as every other write (ADR 0006), with per-scenario keys of the form `${runKey}:${scenarioId}` — and two keys for the scenario that also reverses, since it posts two transactions. Same key replays; a fresh key seeds an independent run. The real prize is resumption: a seed interrupted midway is re-driven under the same key, and what already landed replays while only the missing scenarios post. A server-generated run id was rejected because it would make seed the only non-idempotent write in the system; fixed per-org keys were rejected because they are fatal to the loop — after a reset, a second seed would replay the originals and post nothing, leaving every balance at zero.

**Reset's chunk keys are content-derived beneath the caller's run key**: `${runKey}:${sha256(sorted (accountId, signedAmount) pairs)}`. Content-derived so a retried or resumed chunk re-derives the same key and replays instead of double-posting. Scoped under a run key because a purely content-derived key collides across generations — seed → reset → seed → reset produces a byte-identical second chunk, which would replay the first reset's transaction and leave the balances standing. Chunks within one reset are disjoint by account, so two of them cannot hash alike.

**Both procedures are oRPC endpoints on `adminProcedure`, and nothing else.** No CLI script, no direct `packages/db` caller. This is ADR 0005's open consequence resolved by **never opening the hole** rather than by devising a second derivation rule to govern it. `orgId` and `actorId` arrive from the verified `member` row exactly as they do everywhere else, and the role check, the write rate limit, and the error map are all inherited rather than restated. Practically, a script would also have to conjure or look up both an `organization` row and a `user` row (`ledger_transaction.created_by` is `NOT NULL` with no cascade); an API caller already is both.

## Consequences

- **Pro:** the immutability trigger stays absolute. Nothing in the system can delete a posting, and reset did not become the exception that makes invariant #8 conditional on a flag.
- **Pro:** reset is correct on any history — reversed reversals, double reversals of one original, partially reversed sets — because it reads balances rather than reasoning about a graph.
- **Pro:** no new write path. Every mutation goes through `postTransaction` and `createAccount`, so ordered locking, the funds rule, idempotency, and the audit trail all apply without restatement, and this phase adds no schema change and no migration.
- **Pro:** the seed → reset → seed loop is unbounded, and both endpoints are resumable under a re-used key.
- **Pro:** ADR 0005's open consequence is closed rather than inherited, and `no-org-input.test.ts` mechanically proves neither new input schema names an organization.
- **Con — reset grows history rather than shrinking it.** A sandbox reset several times accumulates a long transaction list and its accounts stay in `accounts.list` forever. "Reset" means the money is unwound, not that the org looks new. A console showing recent activity will show reset's own compensating entries, which is honest but is not what "reset" suggests to a user, and Phase 5 should label it accordingly.
- **Con — seed's insufficient-funds scenario is not idempotent.** A rejected attempt rolls its own key reservation back (ADR 0004; `post-transaction.ts` lines 128-139), so the key never persists and a replayed run re-attempts the transfer, appending a second rejection audit entry each time. No money moves and no transaction is duplicated, but "seed is idempotent" is true only of the four posting scenarios.
- **Con — concurrent resets do not degrade cleanly.** Two callers resetting at once both plan from the same pre-lock read. The first commits and zeroes the balances; the second then applies its deltas under the row lock against balances that are already zero, driving `normal` accounts negative and failing with `422 insufficient_funds` — a safe outcome, but a misleading reason for what is really a lost race. An all-`external` organization instead posts a second time, overshoots, and converges over another loop iteration. Neither corrupts anything; both are avoidable only by re-planning inside the lock, which would need a new `packages/db` primitive.
- **Con — one call costs one rate-limit token but several postings.** Seed performs six `postTransaction` runs, reset one per chunk. Both are bounded (seed by a compile-time constant, reset by the chunk size), so neither is proportional to anything a caller controls, but the endpoint's real cost is not visible from its rate-limit budget.
- **Con — reset reads the full account list twice per call.** `listAccounts` is unpaginated, once to plan and once to compute `remaining`, and `accounts.create` lets an organization's account count grow without bound. This is inherited from the Phase 4a read surface rather than introduced here, but reset is the endpoint most likely to run against a large org. Replacing the second read with a `COUNT` of non-zero balances is the cheap fix when it matters, and it needs a new repository function.
- **Con — a reset chunk is the largest lock footprint in the system.** Up to 100 accounts are locked in one transaction. ADR 0003's sorted lock ordering makes deadlock structurally impossible, and the chunk bound caps the size, but `createDb` still sets no `statement_timeout` (ADR 0007), so a pathologically slow chunk has nothing to cut it short.
