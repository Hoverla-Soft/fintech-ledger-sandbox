# Task: Portfolio review — 100% track completion

## Goal

Close the remaining high-leverage track gaps so the portfolio product review scorecard is fully shipped: account statement sparkline, audit action/reason filters, and thin maker-checker for transfers.

## Status

Done

## Scope (allowed paths)

- `apps/web/src/**`
- `apps/web/e2e/**`
- `packages/api/src/**`
- `packages/db/src/**`
- `packages/db/drizzle/**`
- `packages/db/drizzle/meta/**`
- `docs/tasks/2026-08-01-portfolio-100-percent-completion.md`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/product/roles-and-permissions/ledger.md`
- `docs/adr/**`
- `.claude/.active-task-scope.json`

## Out of scope

Holds/capture, external bank recon, FX reval, Sankey, webhooks, SSO, full SoD packs, PDF statements, split-view org theater (nice-to-haves beyond the incomplete track items).

## Design (approved by implement request)

1. **Sparkline** — CSS bars from `accounts.postings` running balances (extend `DailyBarChart` / small series helper); no new chart lib.
2. **Audit filters** — `action`, `reason` (optional strings) on `audit.list` / repo; UI controls on audit route.
3. **Maker-checker** — separate `ledger_pending_transfer` table (no balance mutation until approve). Procedures: `submitPending`, `listPending`, `approve`, `reject`. Org flag `requireTransferApproval` stored simply (org metadata or dedicated column). Default off so existing demos keep posting immediately; when on, transfer form submits pending. Approve blocked if `actorId === createdBy`. Admin-only submit/approve/reject; viewer list-visible.

## Acceptance criteria

- Account detail shows balance sparkline from statement points
- Audit list filters by action and/or reason server-side
- Pending transfer workflow works end-to-end with self-approve blocked
- Open question #24 marked resolved
- Portfolio canvas can show 100% shipped
- lint / check-types / tests green

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm --filter web exec playwright test e2e/walkthrough.e2e.ts
```

## Retention

Archive when Done.

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
- [x] Idempotency considered (pending keyed like create)
- [x] Tenant isolation considered
- [x] Migration additive

### Frontend
- [x] Empty / loading / error states
- [x] Approvals queue UX
