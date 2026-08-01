# Task: Portfolio showcase high-leverage track

## Goal

Ship the highest-leverage ~20–30% of the portfolio audit backlog so a 5-minute CTO demo communicates enterprise fintech credibility: branded auth, integrity seal, money-flow theater, guided walkthrough, statement-grade history, polish, and a thin enterprise layer.

## Status

Done

## Scope (allowed paths)

- `apps/web/src/**`
- `apps/web/e2e/**`
- `apps/web/package.json`
- `packages/api/src/**`
- `packages/db/src/**`
- `packages/core/src/**`
- `packages/ui/src/**`
- `docs/tasks/2026-08-01-portfolio-showcase-high-leverage.md`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/product/**`
- `docs/context/**`
- `PRODUCT.md`
- `DESIGN.md`
- `README.md`
- `.claude/.active-task-scope.json`

## Out of scope

Holds/auth-capture, external bank recon, FX revaluation, account hierarchy, Sankey/heatmaps, webhooks, realtime sync, offline mode, AI explainer, SSO, full SoD packs, new charting libraries, new animation libraries.

## Related docs

- `docs/product/requirements/ledger.md`
- `docs/product/roles-and-permissions/ledger.md`
- `PRODUCT.md`
- `DESIGN.md`
- `docs/open-questions.md`

## External sources

- Task/issue: N/A: local portfolio roadmap plan
- Product documentation: N/A: local PRODUCT.md / ledger.md
- Design: N/A: local DESIGN.md

## Acceptance criteria

- Phase 1: integrity seal, branded auth (no prod template/devtools tells), money-flow theater, guided sandbox walkthrough
- Phase 2: journal redesign, account statement timeline (+ API), history filters, idempotency panel, fee builder, CSV export, overview CTAs
- Phase 3: org role matrix, API playground, audit UX filters/export; thin maker-checker or explicit deferral in open-questions
- Demo hardening: e2e spine and README 5-minute demo section
- `pnpm lint`, `pnpm check-types`, `pnpm test` green for touched packages

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
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

### Backend
- [x] API endpoints defined
- [x] Validation described
- [x] Error responses defined
- [x] Side effects listed

### Frontend
- [x] Loading state defined
- [x] Empty state defined
- [x] Error state defined
- [x] Navigation after each action defined
- [x] Feedback defined
