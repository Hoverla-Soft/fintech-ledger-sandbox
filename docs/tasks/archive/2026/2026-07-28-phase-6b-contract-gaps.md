# Task: Phase 6b — stop the console papering over the contract

## Goal

Two places where the console currently shows the user something less than the truth because the API cannot tell it more:

- The transaction history table lists transactions **without amounts**, so it can say a transfer happened but not what moved.
- The reversal dialog cannot say whether a transaction **has already been reversed**, so it substitutes typed-confirmation friction for the warning it would rather give.

Both are closed here. Closes open questions **#2** and **#3**.

## Status

Done

Human review waived by the user for Phase 6.

## Scope (allowed paths)

- `packages/db/src/schema/ledger.ts`
- `packages/db/drizzle/**`
- `packages/db/src/repositories/transactions.ts`
- `packages/db/src/repositories/*.test.ts`
- `packages/api/src/contracts/wire.ts`
- `packages/api/src/routers/transactions.ts`
- `packages/api/src/routers/*.test.ts`
- `apps/web/src/routes/_auth/transactions/**`
- `apps/web/src/features/transactions/**`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/backend/api-flow.md`
- `docs/adr/0006-write-endpoint-contract.md`
- `docs/tasks/2026-07-28-phase-6b-contract-gaps.md`

## Out of scope

- **The other API gaps.** #1 (role read), #4 (`replayed` flag), #6/#7 (pagination), #8 (`accounts.deactivate`) stay open — scoped out by the user when Phase 6 was planned.
- **Deduplicating reversals.** This slice makes existing reversals *visible*; it does not make a second reversal illegal. That is a product decision with its own migration and its own failure modes (see D3).
- **`accounts.list` / `reconciliation.verify`.** Untouched.
- **Lint warnings from #16.** Not this slice's job.

## Related docs

- `docs/adr/0006-write-endpoint-contract.md` — line 42 assumes a reverse-lookup capability that does not exist. This slice makes the assumption true.
- `docs/adr/0004-idempotency.md`
- `docs/backend/api-flow.md`
- `docs/product/requirements/ledger.md`

## External sources

- Task/issue: `N/A: local phase task, no external tracker configured.`
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: `N/A`.

## Approved decisions

**D1 — `transactions.list` returns `postings`; it does not invent an `amount`.** The output moves from `z.array(transactionSchema)` to `z.array(transactionWithPostingsSchema)`. Both that schema and its mapper (`toWireTransactionWithPostings`) already exist and already serve `transactions.get`, so this is a reuse, not a new shape, and it makes list and get structurally consistent.

A scalar `amount` field is deliberately **not** added. `Transaction.create` accepts any balanced N-leg set, so a transaction with more than two postings has no single "amount" — a split payroll has five. Synthesising one would replace today's honest silence with a number that is wrong for exactly the transactions a ledger exists to represent faithfully. The console derives a display figure from the postings and can show the real breakdown.

**D2 — the N+1 objection recorded in open question #2 does not apply to the server.** That row rejected amounts-on-list because it would mean "an N+1 `transactions.get` per row — up to 200 membership-checked requests per page". That is the cost of the **client** solving it. Server-side it is **one** additional query: page the transactions, then a single `WHERE transaction_id IN (...)` over `ledger_posting` (already covered by `ledger_posting_transactionId_idx`), grouped in memory. Two queries per page, constant in page size.

**D3 — `reversedBy` is a list, not a boolean or a single id, because double reversal is genuinely possible.** Verified 2026-07-28: `ledger_transaction.reverses_transaction_id` carries **no unique constraint** (`0001_windy_arclight.sql:102` adds only the FK), and `transactions.reverse` performs **no existing-reversal check**. Open question #3 says as much — reversals are "unbounded and not deduplicated". So a `reversed: boolean` or a single `reversedBy: string` would be correct until the first double reversal and silently wrong afterwards, which is the failure mode this whole slice exists to remove. It is `readonly string[]`, and the console renders the count.

**D4 — `reversedBy` is derived at read time, never stored.** The data already exists as the inverse of `reverses_transaction_id`. A denormalized column would need a backfill, a write-path update, and an invariant keeping the two in agreement — three new ways to drift from a truth the database can already answer. What is actually missing is an **index**: nothing in the four existing migrations indexes that column, so the reverse lookup is a sequential scan today.

**D5 — migration `0004` adds a partial index, and it is additive-only.** `CREATE INDEX ... ON ledger_transaction (reverses_transaction_id) WHERE reverses_transaction_id IS NOT NULL`. Partial because the column is null for every non-reversal, which is most rows — the index then covers only the rows the lookup can ever match. No column is added, altered, or dropped; applied history is untouched, per the roll-forward rule.

**D6 — `reversedBy` goes on `transactionSchema`, so list and detail agree.** Placing it only on `get` would let the history table show a reversed transaction with no indication, then contradict itself one click later. Since it lives on the base schema, the list path resolves it in the same batched way as postings — one `WHERE reverses_transaction_id IN (...)` per page. Both directions of the reversal relationship are then navigable from either endpoint.

## Happy path

1. `packages/db`: add the partial index to `schema/ledger.ts`, generate migration `0004`, verify the journal with the integrity guard.
2. `packages/db`: `listTransactions` gains batched postings + batched reversal lookup; `getTransactionById` gains the reversal lookup. Repository tests first — including the double-reversal case D3 turns on.
3. `packages/api`: `transactionSchema` gains `reversedBy`; `transactions.list` output becomes `transactionWithPostingsSchema`. Router tests.
4. `apps/web`: history table renders amounts from postings; reversal dialog warns when `reversedBy` is non-empty.
5. Full verification, docs, archive.

## Acceptance criteria

- `transactions.list` returns each transaction's full `postings` array; a 3+ posting transaction round-trips with all legs intact.
- No scalar `amount` field is added to any wire schema.
- Listing a page of N transactions issues a **constant** number of queries (not N+1) — asserted by a test that counts queries or by construction with a batched `IN` lookup.
- `reversedBy` is present on both `transactions.list` and `transactions.get`, and is `[]` for a transaction that has never been reversed.
- **A transaction reversed twice reports both reversal ids**, in a test that performs two reversals. This is the assertion that would fail if `reversedBy` were modelled as a boolean.
- Migration `0004` adds only a partial index; `node .claude/scripts/migration-integrity-guard.js --check` passes and no existing migration file is modified.
- The history table shows what moved for each transaction.
- The reversal confirmation states that the transaction was already reversed, and how many times, when `reversedBy` is non-empty.
- `docs/adr/0006-write-endpoint-contract.md:42` no longer describes a capability that does not exist.
- Full verification at or above the 6a baseline: `lint` exit 0, `check-types` 6/6, `test` ≥ 576, `build` 2/2, guard PASS.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 6a: `lint` exit 0 (219 files), `check-types` 6/6, `test` 576 passed (73 core + 243 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `lint` **exit 0** (221 files) · `check-types` **6/6 green** · `test` **598 passed** (73 core + **259 web** + 28 db + **238 api**, up from 576) · `build` **2/2 green** · migration guard **PASS**.

**Two things measured that contradicted what was written down.**

1. **Open question #2's N+1 objection was about the wrong actor.** It rejected amounts-on-list because it would mean "up to 200 membership-checked requests per page" — true of the *client* calling `transactions.get` per row, which is what was being rejected, but not of the server. One batched `IN` query does it. A capability was withheld for a whole phase on the strength of a cost that the chosen implementation never had.

2. **ADR 0006's claim that two reversals "both succeed" is not unconditionally true.** The double-reversal test failed on its first run with `insufficient_funds`: each reversal re-debits the wallet, so reversing a 5.00 credit twice against an unfunded `normal` account breaches invariant #6. The test now funds the account first, and the ADR is corrected. This *strengthens* D3 rather than undermining it — whether a second reversal exists is a runtime fact about balances, not a schema-level one, which is exactly why `reversedBy` cannot be a boolean.

**A vacuous test caught by the typechecker, not by running it.** The query-count test first used `db.$client.on("query", …)`. `pg.Pool` emits no `query` event, so the counter would have recorded `0` for both page sizes and `expect(0).toBe(0)` would have passed while measuring nothing — a green test asserting nothing, the same failure class 6a was built to prevent. `tsc` rejected the event name. It now wraps `pool.query` and additionally asserts the count is `> 0`, so a wrapper that stops intercepting fails loudly.

**One existing test correctly failed and was strengthened, not weakened.** `writes.test.ts`'s "history is append-only" compared whole `transactions.get` responses, and `reversedBy` legitimately changes when a reversal is appended. Rather than exempting the field, the test now compares everything *except* `reversedBy` — so a future stored column is still covered automatically — and separately asserts `reversedBy` goes `[]` → `[reversal.id]`. The test now covers more than it did before.

**A flake surfaced, unrelated to this slice.** `features/transfer/transfer-form.test.tsx` failed two cases with `Test timed out in 5000ms` during a full `pnpm test`, then passed 7/7 in isolation and 243/243 on a repeat. Timeouts, not assertion failures; nothing in this diff touches that file. Recorded as open question **#19**, because CI landed in 6a and timing-sensitive tests on a shared runner produce red builds nobody caused.

## Retention

Archive to `docs/tasks/archive/2026/` on `Done`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — an org admin reading history and reversing a transaction.
- [x] Entry point defined — `/transactions` (list) and `/transactions/$transactionId` (detail + reverse).
- [x] Preconditions described — authenticated, org-scoped session; at least one posted transaction.
- [x] Happy path described — see "Happy path".
- [x] Error paths described — a reversal of an already-reversed transaction is **warned about, not blocked** (D3, and "Out of scope"); a malformed cursor stays a 400; a cross-org id stays an indistinguishable 404.
- [x] Permissions considered — reads stay on `orgProcedure`, `reverse` stays on `adminProcedure`. No procedure changes rung; `reversedBy` exposes only ids already visible to the same org.
- [x] Acceptance criteria written
- [x] Tests defined — repository: batched postings, empty `reversedBy`, single reversal, **double reversal**. Router: list output shape, `reversedBy` on both endpoints. Web: amounts render, warning appears when reversed.
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `transactions.list` (output widened to `transactionWithPostingsSchema`), `transactions.get` (gains `reversedBy` via the base schema). No new procedures, no input changes.
- [x] Validation described — unchanged; `reversedBy` is server-derived output, never input.
- [x] Error responses defined — unchanged. This slice adds no new failure mode: both additions are read-side and cannot fail independently of the query they ride on.
- [x] Side effects listed — one additive migration (partial index). No data writes, no behaviour change to posting or reversal.

### Frontend
- [x] Loading state defined — existing `QueryState` skeleton on both screens; unchanged.
- [x] Empty state defined — existing "no transactions yet"; `reversedBy: []` renders no badge rather than an empty one.
- [x] Error state defined — existing `ErrorState`; unchanged.
- [x] Navigation after each action defined — unchanged; reversal still lands on the new transaction's detail.
- [x] Feedback (toast/inline/modal) defined — the already-reversed warning is **inline in the confirmation dialog**, next to the existing typed confirmation, not a toast: it must be read before the action, not reported after it.

---

*Started 2026-07-28.*
