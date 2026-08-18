# Task: Bound the accumulated balance, so an overflow is a typed refusal instead of a 500

## Goal

`docs/open-questions.md` #27. `parseBoundedAmount` bounds every *posting* against int8's range, but nothing bounds the *balance those postings accumulate into*. Post two amounts near the ceiling into one account and `ledger_account.balance` overflows: Postgres raises `22003` (`numeric_value_out_of_range`), which nothing maps, so the caller gets a raw 500 and the audit log gets nothing.

Every other refusal in this ledger is a typed domain error that lands in the audit log with a reason. This is the exception, which makes it the one failure the audit trail cannot explain — and an audit trail with a hole in it is worse than one that is merely incomplete, because the hole is exactly where someone will look.

Outcome: a posting that would push a balance outside what the column can hold is refused as `422 balance_limit_exceeded`, audited like every other refusal, before any write happens.

## Status

Human Review

Verified 2026-08-17: `pnpm lint` (264 files, 0 diagnostics) · `pnpm check-types` (6/6) · `pnpm test` (**755 passed** — core 90, server 13, web 297, db 28, api 327) · `pnpm build` (2/2). Local only; CI has still never executed a check (#10).

## Scope (allowed paths)

- `packages/db/src/posting/post-transaction.ts`
- `packages/db/src/posting/index.ts`
- `packages/db/src/errors.ts`
- `packages/api/src/errors.ts`
- `packages/api/src/contracts/money.ts`
- `packages/api/src/routers/writes.test.ts`
- `packages/api/src/errors.test.ts`
- `apps/web/src/lib/ledger/errors.ts`
- `apps/web/src/lib/ledger/errors.test.ts`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-17-balance-limit-bound.md`

## Out of scope

- **`packages/core`.** int8's range is a fact about Postgres columns, not about money. `packages/core` depends on no sibling and has no notion of a storage backend; putting a persistence limit into `applyDelta` would invert that. The domain stays unbounded, as `Money`'s `bigint` already is.
- **A `CHECK` constraint on `ledger_account.balance`.** Considered and rejected: it needs a migration over a populated table, and the violation still arrives as a driver error to be pattern-matched by SQLSTATE — trading an app-side check for a constraint whose error handling is *more* fragile, not less. The application check runs under the same row lock that already serializes the balance update, so there is no window a constraint would close.
- **Widening the columns to `numeric`.** That is a schema change with a performance cost across every posting and balance read, taken to support amounts no sandbox will ever hold.
- **`transactions.reverse` / `exchange` / `sandbox.*` handler code.** They all reach the ledger through `applyLeg`; the whole point is that one guard covers every path, so no handler should need to know this rule exists.

## Related docs

- `docs/open-questions.md` #27 — the row this closes
- `docs/adr/0002-money-representation.md` — why minor units are `bigint`
- `docs/adr/0003-balance-and-concurrency.md` — the row lock this check runs under
- `docs/backend/error-handling.md` — why messages never interpolate the offending value

## External sources

- Task/issue: `N/A: no external tracker configured`
- Product documentation: `N/A: all product docs are local, in docs/`
- Design: `N/A: no external design source`

## Actors, entry points, preconditions

- **Actor:** any admin posting to the ledger — `transactions.create`, `transactions.reverse`, `exchange`, `approvals.approve`, `sandbox.seed`.
- **Entry point:** all of them, via `postTransaction` / `postExchange` → `applyLeg`.
- **Precondition:** an account whose balance is already close enough to int8's range that one more posting crosses it.

## Happy path

1. `MAX_MINOR_UNITS` gets **one** definition, in `packages/db`, because that is the package that owns the columns whose range it describes. `packages/api/src/contracts/money.ts` imports and re-exports it, so `apps/web` — which consumes it today for client-side pre-validation — needs no change and never reaches past the API package. This mirrors `MAX_PAGE_SIZE`, which `packages/db` owns and `contracts/cursor.ts` re-exports for exactly this "two bounds cannot drift" reason.
2. A new `BalanceLimitExceeded` persistence error joins `packages/db/src/errors.ts` and the `PersistenceError` union. Because `packages/api`'s `LedgerApiError` is `LedgerError | PersistenceError` and `classify()` switches exhaustively, **the compiler refuses to build until the new case is mapped** — the mapping is enforced, not remembered.
3. `applyLeg` checks the resulting balance immediately after `applyDelta` succeeds and before anything is written, throwing `DomainRejection` — the existing mechanism that rolls the whole Postgres transaction back and writes a rejection audit row in a separate transaction.
4. `rejectionReasonCode` and `serializeRejectionMetadata` gain their cases, so the audit row carries `balance_limit_exceeded` plus the formatted balance/delta/resulting.
5. `classify()` maps it to `422 balance_limit_exceeded`; the console's `LEDGER_REASONS` and `describeFailure` gain matching copy. `errors.test.ts` on both sides already asserts the two lists agree, so a half-done change fails by name.

## Error paths

- **Resulting balance outside int8** → `422` with `reason: "balance_limit_exceeded"`, one rejection audit row, no transaction and no postings written.
- **The bound is symmetric on magnitude**, so `−2^63` is refused even though int8 can technically hold it. Off by one, deliberately: `parseBoundedAmount` already bounds inbound amounts the same way, and matching it keeps one rule rather than two that differ by one in a direction nobody will remember.
- **Existing refusals are unchanged.** `InsufficientFunds` is checked inside `applyDelta` and still fires first for a `normal` account going negative; this bound is reached only by a balance that is *large*, not by one that is negative-and-forbidden.

## Permissions

Unchanged. This is a domain rule, not an access-control rule, and it applies identically to every role that can post.

## Side effects

One rejection audit row per refusal, written in its own transaction after the failed one rolls back — the existing `DomainRejection` path, not new machinery. No transaction, posting, or balance write survives.

## Acceptance criteria

- [x] **The claim in #27 is verified before it is fixed.** Confirmed against unmodified code: `error: value "9223372036854775808" is out of range for type bigint`, SQLSTATE `22003`, `routine: 'pg_strtoint64_safe'`, thrown from the balance `UPDATE` at `post-transaction.ts:242` with no audit row written.
- [x] Two postings that each pass `parseBoundedAmount` but together exceed int8 are refused with `422 balance_limit_exceeded`.
- [x] The refusal writes a rejection audit row with `reason = "balance_limit_exceeded"` — the entire point of the row.
- [x] Neither the transaction nor its postings are written, and the account's balance is unchanged.
- [x] `MAX_MINOR_UNITS` has exactly one definition in the repository — `packages/db/src/posting/post-transaction.ts`, re-exported by `packages/api/src/contracts/money.ts`.
- [x] `apps/web`'s reason list and `describeFailure` copy cover the new reason. **Both parity guards fired as designed**: the source-scanning test that reads `packages/api`'s own literals passed once the console list was updated, and the count tripwire failed by name (`has copy for all 26 published reasons`) until it was moved to 27.
- [x] `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` on `Done`, once #27 reflects what shipped.

## Spec completeness checklist

### Common
- [x] Actor(s) defined
- [x] Entry point defined
- [x] Preconditions described
- [x] Happy path described
- [x] Error paths described
- [x] Permissions considered
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — no new endpoint; every posting procedure inherits the rule through `applyLeg`
- [x] Validation described — resulting balance magnitude vs `MAX_MINOR_UNITS`, under the existing row lock
- [x] Error responses defined — `422 balance_limit_exceeded`
- [x] Side effects listed — one rejection audit row, nothing else

### Frontend
- [x] Loading state defined — `N/A: no new screen or request; existing transfer/exchange forms already handle in-flight state`
- [x] Empty state defined — `N/A: no new list surface`
- [x] Error state defined — new `describeFailure` entry, surfaced by the same toast the other `422`s use
- [x] Navigation after each action defined — unchanged; a refused transfer stays on the form with its idempotency key intact, as every other refusal does
- [x] Feedback (toast/inline/modal) defined — `sonner` toast with title + detail, same as `insufficient_funds`

---

*Started 2026-08-17.*
