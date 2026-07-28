# Task: Phase 5e — transaction history and reversal

## Goal

Walk the only cursor-paginated endpoint in the API correctly, and let an admin issue a reversal they cannot accidentally double.

Two things here are harder than they look. The cursor is **opaque and forward-only** — there is no `prevCursor`, no total, and no `hasPrevious` — so back-navigation has to be built from state the client keeps itself. And the API **cannot tell the console whether a transaction has already been reversed**, so the "are you sure" step has to carry that uncertainty honestly instead of pretending to a check it cannot perform.

## Status

Done

Approved at human review 2026-07-28; Phase 5f started immediately after.

## Scope (allowed paths)

**`apps/web` — the screen:**

- `apps/web/src/routes/_auth/transactions/**`
- `apps/web/src/features/transactions/**`
- `apps/web/src/components/shell/**`
- `apps/web/src/routeTree.gen.ts`

**Shared UI (just-in-time primitives only):**

- `packages/ui/src/components/alert-dialog.tsx`

**Documentation:**

- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-5e-history-and-reversal.md`

## Out of scope

- **`apps/web/src/lib/ledger/**`.** 5a's kernel is closed. `idempotency.ts` is consumed for the reversal key exactly as it ships.
- **The transfer form.** 5d's, and settled.
- **Amounts in the list.** `transactions.list` returns `transactionSchema`, which carries no postings and no amounts. Adding them means either an N+1 or an API change — both rejected below (D2).
- **Reconciliation, sandbox, audit.** 5f and 5g.

## Related docs

- `docs/adr/0006-write-endpoint-contract.md`
- `docs/adr/0005-tenant-isolation.md`
- `docs/adr/0003-balance-and-concurrency.md`
- `docs/backend/api-flow.md`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — the cursor is echoed verbatim and never constructed, parsed, or incremented.** It is an opaque base64url token (`packages/api/src/contracts/cursor.ts`) whose internal shape is a `(createdAt, id)` pair. Treating it as data the client understands would couple the console to an encoding the API is free to change, and a hand-built cursor that decodes to an `Invalid Date` would silently return an empty page rather than an error — the exact trap the handler's comment says it exists to prevent.

**D2 — the list shows no amounts, and does not fan out to get them.** `transactions.list` returns `transactionSchema`: id, currency, `reversesTransactionId`, `createdBy`, `createdAt`. Amounts live on `transactions.get`.

Rejected: an N+1 of `transactions.get` per row. At the 200-row maximum that is 200 additional requests per page, each carrying its own membership lookup (`ADR 0005`), against an endpoint that was deliberately shaped to avoid exactly that. Rejected: changing the API to return `transactionWithPostingsSchema`, which reopens Phase 4b's wire contract and its Testcontainers suite from inside a frontend slice.

This is the most visible product compromise in the phase and is recorded as open question #2. The columns that *are* available still identify a transaction usefully, and detail is one click away.

**D3 — back-navigation uses a client-held cursor stack.** The API is forward-only. Pushing each page's cursor onto a stack and popping to go back is the only way to offer "previous" without inventing a backwards cursor. The stack is page state, not persisted — a reload legitimately returns to page one.

**D4 — `400 invalid_cursor` resets to the first page with a visible notice, never a silent empty page.** An expired or malformed cursor rendering as "no transactions" would tell a user their ledger is empty when it is not. That is the single worst thing this screen could say.

**D5 — reversal carries typed-confirmation friction, and states plainly what the console cannot know.** `reversesTransactionId` is a **forward** pointer: it says whether a transaction *is* a reversal, never whether one *has been* reversed. There is no reverse lookup and no filter, and the list is forward-only and capped at 200, so it cannot be walked to find out (open question #3).

`docs/adr/0006-write-endpoint-contract.md` assumes a capability that does not exist here. So rather than a warning the console cannot substantiate, the confirmation says exactly what is true: reversing is permitted, is **not** deduplicated, and two reversals of one transaction under two keys will both succeed and double the correction. Requiring the user to type the confirmation word makes that a deliberate act.

**D6 — the reversal request carries only `{transactionId, idempotencyKey}`.** Never legs. The server rebuilds the mirrored postings from the persisted rows precisely so there is nothing for a caller to tamper with (`transactions.ts` — *"the mirrored legs are rebuilt from the persisted rows, never from anything the caller sent"*). A test asserts the payload contains no `postings` key.

**D7 — there is no edit and no delete affordance anywhere on this screen.** Postings are append-only and the database refuses deletion (invariant #8, `ADR 0003`). A disabled "edit" button would imply the operation exists; its absence is the honest UI.

## Design

### Paging

- `limit` fixed at a sane page size, well inside `1..200`, so the `400 {issues}` branch is unreachable from the UI.
- **Next** is enabled only while `nextCursor !== null`.
- **Previous** pops the client-held stack; disabled on page one.
- Ordering is **oldest-first** (`packages/db` orders by `asc(createdAt), asc(id)`), and the UI says so — a history list that silently reads oldest-first when a user expects newest-first is a misreading waiting to happen.

### Reversal

An `alert-dialog`, admin-only, requiring the word `REVERSE` typed to enable the action. The key comes from `startOperation("reverse:<transactionId>")` so two different transactions never share a slot, and is released on success or on a terminal `409`.

## Acceptance criteria

- A synthetic cursor sequence is echoed unmodified, terminates on `nextCursor === null`, and neither skips nor repeats a page.
- Previous returns to the exact prior page; disabled on page one; Next disabled on the last.
- `400 invalid_cursor` clears the cursor, refetches page one, and shows a notice — never a silent empty page.
- The list renders id, currency, actor, timestamp, and a reversal marker, with **no amounts** and no per-row fetch.
- The reversal payload provably contains **no `postings` key**.
- The confirmation cannot be submitted without typing the confirmation word; dismissing it fires no mutation.
- The reversal key is scoped per transaction and stable across a retry.
- The UI states that reversals are unbounded and not deduplicated, and does not claim to know whether one already exists.
- No edit or delete control appears anywhere on the screen.
- A history nav link exists in the shell.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5d: `check-types` 6/6, `test` 519 passed (73 core + 186 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `check-types` **6/6 green** · `build` **2/2 green** · `test` **535 passed** (73 core + **202 web** + 28 db + 232 api) · migration guard **PASS**. `pnpm lint` — `N/A`. Backend suites untouched; the +16 are all `apps/web` (9 pagination, 7 reversal dialog). `git status apps/web/src/lib/` is empty — 5a's kernel stayed closed, consumed only through its public exports.

**Manual demo** (requires `pnpm db:start` and `pnpm dev`):
1. Post several transfers → history lists them oldest-first.
2. Page forward to the end → Next disables; page back → the same rows return.
3. Reverse a transaction → confirmation requires typing; after posting, the reversal appears in the list marked as one and links to its original.
4. Reverse the same transaction again → it succeeds, as documented, and the correction is applied twice. The UI warned this would happen.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and **delete `.claude/.active-task-scope.json`**.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org viewer reads history; org admin additionally reverses.
- [x] Entry point defined — `/transactions` via the shell nav; rows link to existing detail.
- [x] Preconditions described — a verified active org; at least one posted transaction for the list to be non-empty.
- [x] Happy path described — list → page → open a transaction → reverse with confirmation.
- [x] Error paths described — `invalid_cursor` (D4), `transaction_not_found`, `insufficient_role`, `idempotency_conflict`, `rate_limited`, plus load failures.
- [x] Permissions considered — reverse is admin-only; the control is hidden for viewers and `403 insufficient_role` is handled regardless (ADR 0009).
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: no procedure is added or changed. Consumes `transactions.list`, `transactions.reverse`, `accounts.list` as published.
- [x] Validation described — `limit` constrained client-side inside the published range; the cursor is never validated client-side because it is opaque by contract.
- [x] Error responses defined — the branch list above, all via `describeFailure`.
- [x] Side effects listed — a reversal writes a new transaction, its postings, balance updates, an idempotency key, and an audit entry. History itself is a pure read.

### Frontend
- [x] Loading state defined — skeleton rows while a page loads.
- [x] Empty state defined — "no transactions yet" with a link to the transfer screen.
- [x] Error state defined — distinct from empty, with retry; `invalid_cursor` is a notice on page one rather than an error screen.
- [x] Navigation after each action defined — row → detail; reversal success → the new reversal's detail; dismiss → list unchanged.
- [x] Feedback defined — toast on a successful reversal; inline reason on failure; the confirmation carries the warning text rather than a post-hoc toast.

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it.*

*Phase 5 slice 5 of 8. Predecessors: 5a–5d (all Done). Successors: 5f reconciliation + sandbox · 5g audit · 5h retire `privateData`.*
