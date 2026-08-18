# Task: Reversing one leg of an exchange reverses the pair

## Goal

Close open question #20. Reversing either leg of a cross-currency exchange unwinds **both** legs in one commit, or unwinds neither. Today `transactions.reverse` knows nothing about `fx_source_transaction_id`, so reversing the USD half of a USD→EUR exchange restores the USD side and leaves the converted EUR sitting in the payee's account with the EUR bridge still short — money on the books and unreachable, the same class of state open question #8 refused to allow when closing a funded account.

## Status

Human Review

## Scope (allowed paths)

- `packages/db/src/posting/post-transaction.ts`
- `packages/db/src/posting/index.ts`
- `packages/api/src/contracts/request-hash.ts`
- `packages/api/src/routers/transactions.ts`
- `packages/api/src/routers/exchange.test.ts`
- `apps/web/src/features/transactions/reverse-dialog.tsx`
- `apps/web/src/features/transactions/reverse-dialog.test.tsx`
- `apps/web/src/routes/_auth/transactions/$transactionId.tsx`
- `docs/adr/0010-cross-currency-exchange.md`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-18-fx-pair-reversal.md`

## Design

### Reversing either leg reverses both

`transactions.reverse` already resolves the original through `getTransactionById(db, orgId, ...)`, which returns `fxSourceTransactionId`, `fxTargetTransactionId` and `fxRate`. One read is therefore enough to know whether the named transaction is half of an exchange and which half. When it is, both mirrors are posted through `postExchange` — the routine that already locks the union of both legs' accounts in one sorted call, applies both legs inside one `db.transaction`, and reserves **one** idempotency key. Nothing about that machinery is specific to a conversion; it is "two linked single-currency transactions, committed together", which is exactly what an exchange reversal is.

So `postExchange` gains one optional field — the id each leg reverses — and nothing else changes. No second copy of the posting routine, no second copy of the idempotency scaffolding.

### The reversal pair is itself fx-linked

`R2.fx_source_transaction_id = R1.id`, `R2.fx_rate` = the original rate, mirroring the originals' direction:

```
T1 (USD) ──fx──▶ T2 (EUR)      the exchange
 │                │
 reversedBy       reversedBy
 ▼                ▼
R1 (USD) ──fx──▶ R2 (EUR)      the unwind: one commit, one key
```

Three things fall out of this and are the reason for it:

1. **The wire contract does not change.** `postedTransactionSchema` already carries `fxSourceTransactionId` / `fxTargetTransactionId`, so the reversal returned to the caller names its own counterpart. A response describing one transaction while two were posted would have been the dishonest half of this design; the link removes the need for a new output shape, a new procedure, or a new error code.
2. **`loadPostedExchange` works unchanged.** The idempotency replay path finds the target leg by the FX link. A reversal pair with no link would have needed its own three-hop reload (mirror → original → fx counterpart → its mirror) for no gain.
3. **The unwind is itself reversible as a pair**, which is the redo half of an undo the repo already permits (reversing a reversal targets a different id — see `reverse`'s doc comment).

The rate on the reversal pair is the original's, not its inverse. It is not the rate of a new conversion; it is the rate this pair unwinds, and it relates R1's 100.00 USD to R2's 92.00 EUR by exactly the arithmetic `convert` already performed. Recording `1/0.92` instead would be a figure no one agreed to and one that is not exactly representable.

### What happens when the counterpart is unaffordable

Both mirrors run inside one `db.transaction`, so if the payee has spent the converted funds the second mirror rejects with `InsufficientFunds` and the *whole* reversal rolls back — including the leg that would have succeeded. That is the point: an exchange whose proceeds are gone cannot be unwound, and the failure must not leave the half-state this task exists to remove. The refusal is the existing `422 insufficient_funds`, audited by the existing rejection path.

### A leg reversed under the old behaviour

Data can already exist where one leg was reversed alone. Reversing the survivor must not then attempt a second reversal of the leg that already has one — `reverses_transaction_id`'s partial UNIQUE index (open question #3) would refuse it and the remaining leg would be stranded permanently, which is worse than the bug being fixed. So: when the counterpart already carries a reversal, the named leg is reversed **alone** through the existing `postTransaction` path. There is only one leg left to unwind, and completing the unwind is the correct answer.

## Approach

**Scope expanded once, before coding, for `packages/api/src/contracts/request-hash.ts`.** The pair needs a fingerprint and `computeExchangeRequestHash` covers only `(source legs, target legs, rate)` — nothing about *which* exchange is being unwound. Two identical exchanges (same accounts, same amounts, same rate, posted twice) produce identical mirror legs, so reversing pair A and then reusing that key against pair B would hash the same and replay A's reversal while B stayed un-reversed. That is verbatim the failure ADR 0006 puts `reversesTransactionId` in the ordinary hash to prevent, and it does not exist in the exchange hash because until now no exchange was ever a reversal.

So `computeExchangeRequestHash` takes an optional `reverses: [sourceId, targetId]`. It is **omitted from the serialized payload entirely when absent**, not emitted as `null`: `request_hash` is persisted and compared on every retry, so adding a key to that object would re-hash every stored exchange key and turn honest retries into false `409`s — the un-versioned-canonical-format hazard ADR 0006 records as a known con.

Order of work:

1. `contracts/request-hash.ts` — the optional `reverses` tuple.
2. `packages/db` — `PostExchangeInput.reverses`, spread into each `applyLeg` call. Nothing else in `postExchange` moves: the union lock, the single key reservation, and `loadPostedExchange`'s FX-link reload all already do the right thing for a linked pair.
3. `packages/api` `transactions.reverse` — read the original once, branch on its FX fields, build both mirrors from persisted rows, call `postExchange`, return the mirror of the leg the caller named.
4. Integration tests in `exchange.test.ts`, then the console copy, then docs.

Two tradeoffs worth flagging now:

- **The response carries the named leg's balances only**, not all four accounts'. `postedTransactionSchema` documents `balances` as "every account this transaction touched", and one mirror touched two accounts; merging both legs' maps would make the field mean something else. The console invalidates `accounts.list` on success, so it does not read balances from this response anyway.
- **Already-reversed detection is left to the database.** If either leg already carries a reversal, `applyLeg`'s `ledger_transaction_reversesTransactionId_idx` violation surfaces as a typed `409 already_reversed` and the whole pair rolls back — no handler pre-check, which would be racy for exactly the reason ADR 0006 gives. The one place the handler *does* look first is the counterpart-already-reversed fallback, and that is a routing decision (which path to take), not a correctness guard: taking the pair path there would refuse forever and strand the survivor.

## Out of scope

- **A new `transactions.reverseExchange` procedure**, and refusing single-leg reversal with a new `422`. Considered and rejected: it costs a wire output type, an entry in the frontend's `LEDGER_REASONS` vocabulary, user-facing copy, a second confirmation path in the console, and it breaks the existing Reverse button on every FX transaction — all to express something the FX link already expresses.
- **FX revaluation and gain/loss (open question #21).** Unwinding a position is not marking one to market, and #21 is blocked on a rate source #22 deliberately refuses.
- **A rate source (#22) and same-currency exchange (#23).** Both are `By design` in ADR 0010; they are decisions on the record, not gaps.
- **`packages/core`.** `reverse(transaction)` already mirrors a balanced transaction correctly and knows nothing about FX links — pairing is a persistence-layer fact about two rows, not a domain fact about one.
- **Reconciliation, the dashboard, and the FX bridge accounts.** Per-currency conservation holds through the unwind for the same reason it holds through the exchange: each leg nets to zero inside its own currency. Nothing there should need a change, and a change there would mean this design is wrong.

## Related docs

- `docs/adr/0010-cross-currency-exchange.md` — the two-transaction model, the union lock, the single key, and the "reversing one leg reverses only that leg" limitation this task retires
- `docs/adr/0006-write-endpoint-contract.md` — idempotency and the reversal contract
- `docs/open-questions.md` — #20 (this task), #3 (reversal uniqueness), #21/#22/#23 (deliberately untouched)

## External sources

- Task/issue: N/A: tracked in `docs/open-questions.md` #20; this project declares no external tracker (`docs/development/work-systems.md`)
- Product documentation: N/A: local, `docs/adr/0010-cross-currency-exchange.md`
- Design: N/A: no visual change beyond one paragraph of dialog copy

## Acceptance criteria

- Reversing the **source** leg of an exchange posts two linked reversals in one commit; both original legs report a reversal, and both bridge balances return to their pre-exchange values.
- Reversing the **target** leg does the same, and the two paths produce the same ledger state.
- The reversal returned by `transactions.reverse` names its counterpart through `fxTargetTransactionId` / `fxSourceTransactionId`; `postedTransactionSchema` is unchanged.
- One idempotency key covers the pair. A replay returns the same reversal and posts nothing further.
- When the payee has spent the converted funds, the reversal is refused with `422 insufficient_funds` and **neither** leg is posted — the payer's balance and both bridges are untouched.
- When the counterpart leg already carries a reversal, the named leg is reversed alone rather than refused.
- Reversing an ordinary (non-FX) transaction is byte-identical to today.
- The reverse dialog states that both legs will be reversed when the transaction is part of an exchange, and does not say so otherwise.
- ADR 0010's "What this does not do" entry for single-leg reversal is replaced by what actually happens; open question #20 moves to the resolved index.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` on `Done`, after ADR 0010, `docs/open-questions.md`, and `docs/test-coverage.md` carry the durable parts.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org `admin` (`directPostProcedure`; unchanged from `transactions.reverse` today)
- [x] Entry point defined — `transactions.reverse`, reached from the Reverse button on the transaction detail screen
- [x] Preconditions described — the named transaction exists in the caller's org; approvals gate (`directPostProcedure`) already applies
- [x] Happy path described — both mirrors posted in one commit, linked, one key
- [x] Error paths described — `422 insufficient_funds` (whole pair refused), `409 already_reversed`, counterpart-already-reversed falls back to single-leg
- [x] Permissions considered — no new rung; `directPostProcedure` carries the maker-checker gate closed by #25
- [x] Acceptance criteria written
- [x] Tests defined — see below
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `transactions.reverse`, no new procedure, no input change
- [x] Validation described — the FX pair is read from persisted rows, never from the request; the request still carries only an id
- [x] Error responses defined — reuses the existing translated errors; no new reason code
- [x] Side effects listed — two transactions, two posting sets, balance updates on up to four accounts, one idempotency row, audit entries per leg

### Frontend
- [x] Loading state defined — unchanged (`Reversing…` on the dialog's confirm button)
- [ ] Empty state defined — N/A: no list or collection is introduced
- [x] Error state defined — unchanged; the existing inline `role="alert"` renders `insufficient_funds` from the shared vocabulary
- [x] Navigation after each action defined — unchanged: navigate to the returned reversal, which now links to its counterpart
- [x] Feedback (toast/inline/modal) defined — unchanged `Reversal posted` toast

### Tests
- `packages/api/src/routers/exchange.test.ts` — reverse the source leg; reverse the target leg; both bridges and both party balances restored; replay of the reversal key posts nothing further; unaffordable counterpart refuses the whole pair and leaves every balance untouched; counterpart-already-reversed reverses the survivor alone.
- `apps/web/src/features/transactions/reverse-dialog.test.tsx` — the pair warning appears for an FX leg and not for an ordinary transaction.

## Verification results (2026-08-18)

All four green, run at the repo root after the last change:

- `pnpm lint` — 269 files, zero diagnostics (`biome check --error-on-warnings .`)
- `pnpm check-types` — 6/6 workspaces
- `pnpm test` — **773 passed**, up from 763: `core` 90, `server` 13, `web` 299, `db` 28, `api` 343
- `pnpm build` — 2/2

**One acceptance criterion was wrong when first implemented, and the tests caught it.** The counterpart-already-reversed fallback checked only the counterpart, which also matches a pair this endpoint had *already* unwound — both legs carry a reversal then. So an honest replay of an unwind was routed down the single-transaction path under a different fingerprint and came back as a false `409 idempotency_conflict`. Narrowed to "the named leg still needs unwinding **and** its counterpart no longer does". The failing test was `replays the whole unwind for a repeated key`, which is exactly the case a hand-check would have called obviously fine.

---

*Started 2026-08-18.*
