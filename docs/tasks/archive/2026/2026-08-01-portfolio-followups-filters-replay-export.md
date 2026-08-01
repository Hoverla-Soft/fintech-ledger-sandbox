# Task: Portfolio follow-ups — filters, replayed, CSV walk, e2e

## Goal

Close the thin high-leverage leftovers after the portfolio showcase track: server-side transaction history filters with a full filtered CSV walk, a `replayed` flag on write responses (open question #4), and green Playwright demo-spine coverage.

## Status

Done

## Scope (allowed paths)

- `apps/web/src/**`
- `apps/web/e2e/**`
- `packages/api/src/**`
- `packages/db/src/**`
- `docs/tasks/2026-08-01-portfolio-followups-filters-replay-export.md`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/adr/0006-write-endpoint-contract.md`
- `.claude/.active-task-scope.json`

## Out of scope

Maker-checker, holds/capture, new charting libraries, audit server-side export API (client walk of filtered transaction pages only), schema migrations unless strictly required for `replayed` (prefer response-only flag).

## Related docs

- `docs/open-questions.md` (#4 replayed flag)
- `docs/adr/0006-write-endpoint-contract.md`
- `docs/product/requirements/ledger.md`

## External sources

- Task/issue: N/A: follow-up from portfolio roadmap thin leftovers
- Product documentation: N/A: local
- Design: N/A: local

## Acceptance criteria

- `transactions.list` accepts filters: `accountId`, date range (`createdAfter`/`createdBefore`), min/max amount (debit-leg magnitude or documented convention), `reversalsOnly` (or equivalent kind); cursor pagination remains correct under filters
- History UI drives those filters server-side (not page-local only); copy updated
- CSV export walks all matching pages under current filters (cap documented if any) and downloads the full filtered set
- `transactions.create` / `.reverse` / exchange write responses include `replayed: boolean`; UI can show replay vs fresh (idempotency panel or toast)
- Open question #4 updated to Resolved (or narrowed) when flag ships
- `apps/web/e2e/walkthrough.e2e.ts` passes against local stack
- `pnpm lint`, `pnpm check-types`, `pnpm test` green for touched packages

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm --filter web exec playwright test e2e/walkthrough.e2e.ts
```

## Retention

Move to `docs/tasks/archive/2026/` when Done.

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

### API / backend
- [x] Input/output contract described
- [x] Idempotency considered
- N/A: no new persistence for replayed (derived from reserve path)
- [x] Tenant isolation considered

### Frontend
- [x] Empty / loading / error states
- [x] Filter + export UX

### Data
- N/A: no migration required for response-only `replayed`
