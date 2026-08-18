# Task: Page the approvals queue, and bound how long a connection may hold the database

## Goal

Two independent gaps recorded by the 2026-08-16 audit (`docs/open-questions.md` #29 and the remainder of #28), grouped because neither changes ledger arithmetic and both are contained operational hardening.

1. **#29** — `listPendingTransfers` reads `.limit(100)` with no cursor. The 101st pending transfer is not "on page two", it is invisible, on the one screen whose entire job is "what is waiting on you". An org that turns maker-checker on and submits steadily hits a queue that silently stops growing.
2. **#28 remainder** — `createDb` is a bare `drizzle(connectionString)` with no pool options at all, so a statement can block indefinitely, an abandoned transaction can hold its locks indefinitely, and a connect attempt against a dead Postgres hangs rather than failing.

Outcome: the approvals queue is walkable the same way every other list here is, and a stuck query surfaces as an error instead of a held connection.

## Status

Human Review

Verified 2026-08-17: `pnpm lint` (264 files, 0 diagnostics) · `pnpm check-types` (6/6) · `pnpm test` (**650 passed** — web 297, api 325, db 28) · `pnpm build` (2/2). Local only; CI has still never executed a check (#10).

## Scope (allowed paths)

- `packages/db/src/repositories/pending-transfers.ts`
- `packages/db/src/index.ts`
- `packages/db/package.json` — only if `pg` must be promoted to a direct dependency to type the pool options
- `packages/api/src/routers/approvals.ts`
- `packages/api/src/routers/approvals.test.ts`
- `packages/api/src/routers/pagination.test.ts`
- `apps/web/src/routes/_auth/approvals.tsx`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-17-pending-paging-and-pool-timeouts.md`

## Out of scope

- **`packages/db/src/schema/**` and any migration.** The existing `ledger_pending_transfer_orgId_status_createdAt_idx` already covers the `(org_id, status, created_at)` prefix the keyset walk needs. Adding `id` as a fourth column would match nothing else in this schema — `ledger_audit_entry_orgId_createdAt_idx` omits its tiebreaker too — so it would be a migration over a populated table bought for a tie group that is at most a handful of rows at millisecond precision.
- **`approvals.approve` / `reject` / `submitPending`.** Money-path handlers, untouched by a read change.
- **#27 (per-balance bound) and #18 (vendoring `shadcn/tailwind.css`).** Their own tasks; #27 changes a refusal on the money path and #18 carries visual-regression risk.
- **`packages/db/src/test/setup.ts` and `global-setup.ts`.** They call `createDb` and will inherit the new pool options; that is intended and needs no edit. If a timeout breaks the Testcontainers harness, that is a signal the bound is wrong, not that the harness needs an exemption.
- Lowering `statement_timeout` toward the 1s range. See the reasoning in open question #28: `reserve-key.ts` blocks on a lock *on purpose*, and a bound that fires during a legitimate contention wait converts a correct serialization into an error.

## Related docs

- `docs/open-questions.md` #28, #29 — the rows this closes, and #6/#7 for the pattern already established
- `docs/adr/0004-idempotency.md` — the reservation whose deliberate blocking `INSERT` constrains the `statement_timeout` choice
- `docs/product/roles-and-permissions/ledger.md` — the admin/viewer split this read deliberately does *not* narrow
- `packages/db/src/repositories/pagination.ts` — `clampPageSize` / `splitPage`, the shared half
- `packages/api/src/contracts/cursor.ts` — opaque cursor encode/decode and the shared `invalid_cursor` 400
- `apps/web/src/components/paging.tsx` — `usePageState`, `PageControls`, `CursorExpiredNotice`, `useCursorRecovery`

## External sources

- Task/issue: `N/A: no external tracker configured` — see `docs/development/work-systems.md`
- Product documentation: `N/A: all product docs are local, in docs/`
- Design: `N/A: no external design source; tokens in packages/ui/src/styles/globals.css are authoritative`

## Actors, entry points, preconditions

- **Actor:** any org member for the read (`orgProcedure` — a viewer must be able to see what is queued even though they cannot decide it); an authenticated admin for approve/reject, unchanged.
- **Entry point:** `GET`-equivalent oRPC call `approvals.listPending`, rendered at `/approvals`.
- **Precondition:** an active organization. `requireOrg` already resolves and verifies membership.

## Happy path

1. `listPendingTransfers` takes a `PageRequest<TimeCursor>` and returns a `Page<PendingTransferRow, TimeCursor>`, ascending on `(created_at, id)` — oldest first, because an approvals queue is FIFO and the thing that has waited longest is the thing most in need of a decision. The cursor predicate is therefore `>`, not the `<` the audit log uses.
2. `approvals.listPending` accepts `pageInputShape` (`limit`, `cursor`), decodes with `decodeTimeCursorOrThrow`, and returns `{ pending, nextCursor }`.
3. `/approvals` composes `usePageState` + `PageControls` + `CursorExpiredNotice` + `useCursorRecovery`, exactly as `/audit` does.
4. `createDb` passes explicit pool options, with these values:

   | Option | Value | Why this number |
   |---|---|---|
   | `statement_timeout` | **10s** | Server-side, so Postgres actually aborts the statement and releases its locks. The client-side `query_timeout` is the wrong tool: it makes node-postgres stop waiting while the server keeps running the query and holding the lock. 10s and not 1s for the reason open question #28 records — `reserve-key.ts` blocks on a lock *deliberately*, so a tight bound converts a correct serialization into a spurious error. |
   | `idle_in_transaction_session_timeout` | **30s** | Longer than `statement_timeout` on purpose: this one catches an *abandoned* transaction, not a slow one, and a legitimate transaction spans several statements. Setting it at or below `statement_timeout` would kill transactions that are merely working. |
   | `connectionTimeoutMillis` | **5s** | A connect attempt against a dead Postgres must fail rather than hang, because `/ready` queries the database and a probe that hangs is one a supervisor cannot act on — the same failure direction as the liveness bug #28 already fixed. |

## Error paths

- **Malformed cursor** → the shared `400 invalid_cursor` from `contracts/cursor.ts`. The console's `useCursorRecovery` catches that reason and falls back to page one rather than rendering an empty list — an empty list here would read as "nothing is waiting on you", which is the most dangerous wrong answer this screen can give.
- **`limit` out of range** → Zod `400`, bounded by the shared `MAX_PAGE_SIZE`.
- **Statement exceeding `statement_timeout`** → Postgres aborts it; because `postTransaction` runs inside one transaction, the abort rolls back whole rather than partially, and the caller holds an idempotency key that makes a retry safe. An abort costs a retry, not a correctness violation.

  **This path is deliberately not pinned by a test, and that is a gap rather than a decision to be proud of.** Provoking it honestly means holding a real lock for over ten seconds, which buys a >10s test in a suite that currently has none, in exchange for asserting a Postgres behaviour rather than any behaviour of ours. What *is* pinned is the inverse and more valuable property — that the bound does not fire on legitimate contention — by `post-transaction.concurrency.test.ts` continuing to pass unchanged.
- **`migrate()` runs through this same pool.** No current migration comes close to 10s against the empty database Testcontainers starts, so this is a note rather than a blocker: a future `CREATE INDEX` over a populated table will need `SET LOCAL statement_timeout = 0` rather than a raised global.

## Permissions

Unchanged. `listPending` stays on `orgProcedure`; paging is not a permission boundary and every query remains `org_id`-filtered independently, so a forged cursor cannot page into another tenant (`contracts/cursor.ts`).

## Side effects

None. Both changes are reads and connection configuration; no row is written, no audit entry is added.

## Acceptance criteria

- [x] `listPendingTransfers` accepts a cursor and returns `nextCursor`; the hardcoded `.limit(100)` is gone.
- [x] A test walks a queue **larger than one page** and asserts every submitted transfer is reachable — not that page one has the right length. An assertion about a total or an absence cannot read one page (the lesson recorded in #7).
- [x] A test asserts the walk is ascending, so the oldest pending transfer is on page one. **Asserted as a strictly increasing `(createdAt, id)` pair, not as submission order** — six inserts in a tight loop can share a millisecond, and the naive assertion would have flaked on the uuid tiebreaker.
- [x] A malformed cursor on `approvals.listPending` returns `400` with `reason: "invalid_cursor"`, matching the other five paginated procedures.
- [x] `createDb` sets `statement_timeout: 10s`, `idle_in_transaction_session_timeout: 30s`, and `connectionTimeoutMillis: 5s`, each with the reason written next to it, and `idle_in_transaction_session_timeout > statement_timeout`.
- [x] The full existing suite passes unchanged — `post-transaction.concurrency.test.ts` in particular, 5 tests in **468ms** against a 10s bound.
- [~] `/approvals` pages, and shows the cursor-expired recovery rather than an empty table. **Code complete, not browser-verified.** The paging primitives it composes (`usePageState`, `goToNext`/`goToPrevious`, `hasPrevious`, expired-cursor reset) are unit-covered in `apps/web/src/lib/pagination.test.ts` and identically composed on five shipped screens, and the whole `apps/web` suite (297 tests) passes — but nobody has clicked Next on this screen. Recorded rather than ticked.
- [x] `docs/open-questions.md` #28 and #29 updated to match what shipped.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` on `Done`, once #28/#29 in `docs/open-questions.md` reflect what shipped.

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
- [x] API endpoints defined — `approvals.listPending`, input/output shape above
- [x] Validation described — `pageInputShape`, `MAX_PAGE_SIZE`, `MAX_CURSOR_LENGTH`
- [x] Error responses defined — `400 invalid_cursor`, Zod `400`
- [x] Side effects listed — none

### Frontend
- [x] Loading state defined — `QueryState` with `loadingRows`, as on `/audit`
- [x] Empty state defined — existing `EmptyState`, gated on `!hasPrevious(paging.page)` so an emptied last page does not claim the queue is empty
- [x] Error state defined — `QueryState` error branch, plus `CursorExpiredNotice`
- [x] Navigation after each action defined — approve still navigates to the posted transaction, reject stays put. **Paging navigates nowhere:** cursor state lives in React state, not the URL, matching `/audit` and the other four paged screens. So a page-2 link is not shareable and a refresh returns to page one. That is the established behaviour here, not an oversight; changing it is a decision for all six screens at once, not this task
- [x] Feedback (toast/inline/modal) defined — unchanged `sonner` toasts

---

*Started 2026-08-17.*
