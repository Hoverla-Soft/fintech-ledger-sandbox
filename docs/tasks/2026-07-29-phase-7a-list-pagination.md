# Task: Cursor-paginate the three unbounded read surfaces (open questions #6, #7)

## Goal

No org-scoped read can return an unbounded or silently-truncated result set. `audit.list`, `audit.rejections`, `accounts.list`, and `reconciliation.verify` all become cursor-paginated on the same opaque-token contract `transactions.list` already uses, and every console screen that reads them either pages or says out loud that it is showing a first page.

Two correctness rules that outrank "add a cursor":

1. **`reconciliation.verify`'s verdict must stay whole-org.** `allReconciled` computed over one page would report a clean ledger while drift sat on page two. The page becomes a page; the yes/no answer moves to a separate whole-org aggregate (`accountCount`, `unreconciledCount`) and `allReconciled` is derived from that, not from the rows returned.
2. **`accounts.list` has three consumers that are not tables** — the transfer picker, the transaction-detail account-name lookup, and the transfer eligibility check. Paginating the endpoint must not silently shrink what they see. Where a consumer needs more than one page's worth, it states the ceiling on screen rather than truncating quietly.

## Status

Human Review

Verified 2026-07-29: `pnpm lint` (0 errors; 28 pre-existing warnings/infos, open question #16, none in files this task touched), `pnpm check-types` (6/6 packages), `pnpm test` (core 73, db 28, api 260, web 276 — all green), `pnpm build` (2/2).

## Scope (allowed paths)

- `packages/db/src/repositories/pagination.ts`
- `packages/db/src/repositories/accounts.ts`
- `packages/db/src/repositories/audit.ts`
- `packages/db/src/repositories/reconciliation.ts`
- `packages/db/src/repositories/transactions.ts`
- `packages/db/src/repositories/index.ts`
- `packages/db/src/repositories/reconciliation.test.ts`
- `packages/db/src/repositories/pagination.test.ts`
- `packages/db/src/repositories/tenant-isolation.test.ts`
- `packages/db/src/posting/ledger-scenarios.test.ts`
- `packages/api/src/routers/sandbox.test.ts`
- `packages/api/src/procedures.test.ts`
- `packages/api/src/contracts/cursor.ts`
- `packages/api/src/contracts/cursor.test.ts`
- `packages/api/src/contracts/wire.ts`
- `packages/api/src/routers/accounts.ts`
- `packages/api/src/routers/audit.ts`
- `packages/api/src/routers/reconciliation.ts`
- `packages/api/src/routers/transactions.ts`
- `packages/api/src/routers/reads.test.ts`
- `packages/api/src/routers/pagination.test.ts`
- `apps/web/src/lib/pagination.ts`
- `apps/web/src/lib/pagination.test.ts`
- `apps/web/src/components/paging.tsx`
- `apps/web/src/features/transactions/pagination.ts`
- `apps/web/src/features/transactions/pagination.test.ts`
- `apps/web/src/features/accounts/account-page.ts`
- `apps/web/src/features/accounts/account-page.test.ts`
- `apps/web/src/routes/_auth/accounts/index.tsx`
- `apps/web/src/routes/_auth/accounts/$accountId.tsx`
- `apps/web/src/routes/_auth/audit.tsx`
- `apps/web/src/routes/_auth/reconciliation.tsx`
- `apps/web/src/routes/_auth/transactions/index.tsx`
- `apps/web/src/routes/_auth/transactions/$transactionId.tsx`
- `apps/web/src/routes/_auth/transfer.tsx`
- `apps/web/src/routes/_auth/dashboard.tsx`
- `docs/open-questions.md`
- `docs/test-coverage.md`

## Out of scope

- **`transactions.list`'s own pagination.** It is already correct; it is in Scope only because the shared cursor/page helpers are extracted out from under it, and because renaming `TransactionCursor` to `TimeCursor` touches its declarations. No behavior change.
- **`listAccounts`' unbounded whole-org read.** `packages/api/src/routers/sandbox.ts` calls it in four places to plan and verify a sandbox reset, which by definition must see *every* account balance — a paged read there would silently reset only the first page. `listAccounts` therefore keeps its current unbounded contract for internal server-side callers, and the wire read becomes a separate `pageAccounts`. `sandbox.ts` is deliberately **not** in Scope and must not change.
- **`reconcileAccounts`' unbounded whole-org read**, for the same reason: four integration suites assert invariant #2 across every account, which is exactly what ADR 0003 says the function is for. Paging is added alongside it, not in place of it.
- **The aggregate dashboard endpoint and charts.** Separate task (`phase-7b`) — this task removes the dashboard's dependency on counting `accounts.list` client-side only insofar as pagination forces it, and leaves the dashboard otherwise alone.
- **Cross-currency FX.** Separate task (`phase-7c`).
- **`accounts.deactivate` (#8), role-returning read (#1), replay flag (#4).** Untouched.
- **Any behavior change in `sandbox.test.ts` or `ledger-scenarios.test.ts`.** They are in Scope only because the read contracts they call changed shape (`.list()` → `.list({})`, an array → a `.items` page). The assertions themselves stay exactly as strong as they were.
- Reversal deduplication, the `packages/ui` dead-class debt (#15), the outstanding Biome diagnostics (#16).

## Related docs

- `docs/open-questions.md` — #6 (`audit.list` has no cursor, caps at 200), #7 (`accounts.list` / `reconciliation.verify` unpaginated)
- `docs/adr/0003-balance-and-concurrency.md` — reconciliation is an assertable invariant, not a batch job; this is why its verdict may not be per-page
- `docs/adr/0005-tenant-isolation.md` — no procedure accepts an organization id; cursors carry a sort key and an id, never an `orgId`
- `docs/product/roles-and-permissions/ledger.md` — `admin` and `viewer`; all four procedures here are reads open to both
- `docs/development/architecture.md` — repository/router split

## External sources

- Task/issue: N/A: no external tracker configured (`docs/development/work-systems.md` is an unfilled template — open question #12)
- Product documentation: N/A: local only, `docs/product/requirements/ledger.md`
- Design: N/A: no design source configured

## Acceptance criteria

- `audit.list`, `audit.rejections`, `accounts.list`, `reconciliation.verify` each accept `limit` (1..200) and an optional opaque `cursor`, and each return `nextCursor: string | null`.
- A malformed or expired cursor returns `400 invalid_cursor` on every one of them — never an empty page. Pinned by a test per endpoint.
- Walking every endpoint with a page size of 2 visits every row exactly once, with no duplicates and no gaps, including across rows that share a `created_at` millisecond.
- `reconciliation.verify` reports `allReconciled: false` when the *only* drifting account sits outside the first page. This is the test that would fail if the verdict were computed per-page.
- `reconciliation.verify` returns `accountCount` and `unreconciledCount` covering the whole org regardless of page size.
- The audit screen pages instead of stating a 200-entry ceiling, and the "older entries exist but cannot be paged to yet" caveat is gone.
- The accounts screen pages. The transfer picker and the transaction-detail name lookup state on screen when more accounts exist than they loaded, instead of silently showing a subset.
- Cursors stay opaque: no consumer constructs, decodes, or inspects one.
- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Task files are working records. When this task reaches `Done`, `Cancelled`, or `Superseded`, move it from `docs/tasks/` to `docs/tasks/archive/2026/` unless the user explicitly keeps it active.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — any authenticated member of an org; both `admin` and `viewer`, since all four procedures are reads on `orgProcedure`
- [x] Entry point defined — the accounts, audit, reconciliation, transfer, and transaction-detail console screens; and the four oRPC procedures directly
- [x] Preconditions described — an active organization and a verified `member` row (`orgProcedure`); no other precondition
- [x] Happy path described — first page returned with `nextCursor`; caller re-requests with that token; `nextCursor: null` ends the walk
- [x] Error paths described — malformed/expired cursor → `400 invalid_cursor`; `limit` outside `1..200` → `400` with issues; missing membership → `403` (unchanged)
- [x] Permissions considered — unchanged: every query stays `org_id`-filtered, and a forged cursor cannot page into another tenant because the filter is applied independently of the cursor
- [x] Acceptance criteria written
- [x] Tests defined — see Acceptance criteria; db-level page-walk tests, api-level contract tests, web-level pure-function tests for the page-state helpers
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `accounts.list`, `audit.list`, `audit.rejections`, `reconciliation.verify`
- [x] Validation described — `limit`: `z.int().min(1).max(200).optional()`; `cursor`: `z.string().min(1).max(512).optional()`, decoded server-side
- [x] Error responses defined — `400 invalid_cursor`, `400` schema issues, `403` unchanged
- [x] Side effects listed — none; all four are reads

### Frontend
- [x] Loading state defined — existing `QueryState` skeletons; paging controls disabled while `isFetching`
- [x] Empty state defined — existing `EmptyState` per screen, shown only on page one (`!hasPrevious`)
- [x] Error state defined — `invalid_cursor` resets to page one with a visible notice, reusing the pattern already shipped on the transactions screen
- [x] Navigation after each action defined — paging is in-place; no route change
- [x] Feedback (toast/inline/modal) defined — inline. Page number, disabled Previous/Next, and an explicit notice when a non-table consumer loaded only a first page

---

*Started 2026-07-29.*
