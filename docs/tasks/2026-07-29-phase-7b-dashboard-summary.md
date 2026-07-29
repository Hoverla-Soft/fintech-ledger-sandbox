# Task: An org summary endpoint, and a dashboard that visualizes it

## Goal

The dashboard stops counting a page of `accounts.list` and starts reading a purpose-built aggregate. One new procedure, `dashboard.summary`, answers the questions an overview screen actually asks — how much is held per currency, how much has moved recently, how many transactions and refusals there have been — entirely in SQL aggregates, with no row lists and no per-row fan-out.

The dashboard then renders it: stat tiles, a per-currency position chart, and a daily activity chart.

The point of the endpoint is that **these figures cannot be derived client-side from a paginated list**. Phase 7a made every list read a page, which is correct, and which means "how many accounts does this org have" now has exactly one honest answer: ask the server for a count.

One ledger-specific fact gets first-class treatment: **money is conserved.** Because every transaction is balanced and single-currency, the signed sum of *all* account balances in a currency is necessarily zero — normal accounts and external accounts are exact mirrors. The summary returns both sides so the dashboard can show it holding, which is a far more meaningful health signal on a ledger than a total-balance number would be.

## Status

Human Review

Verified 2026-07-29: `pnpm lint` (0 errors), `pnpm check-types` (6/6), `pnpm test` (core 73, db 28, api 271, web 301 — 673 total), `pnpm build` (2/2). Charts additionally verified in a real browser in both themes — see the note at the end of `docs/test-coverage.md`'s Phase 7b section for the two defects that pass caught.

**Colour validation on record.** `--chart-1` was run through the data-viz validator against both theme surfaces (`#105e60` on `#fffefd`, `#39abac` on `#121e22`): **contrast passes ≥ 3:1 in both**. The validator also reports the hue below its chroma floor, and marginally outside the lightness band in dark mode. Both of those checks are scoped by the validator itself to *categorical* palettes — where hues must be distinguishable from one another — and every chart here has exactly one series. The token's chroma is additionally a deliberate, documented sRGB gamut ceiling in `packages/ui/src/styles/globals.css`, which warns against raising it; doing so to satisfy an inapplicable check would make the colour render differently per browser engine.

## Scope (allowed paths)

- `packages/db/src/repositories/summary.ts`
- `packages/db/src/repositories/index.ts`
- `packages/api/src/routers/dashboard.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/contracts/wire.ts`
- `packages/api/src/routers/dashboard.test.ts`
- `packages/api/src/routers/no-org-input.test.ts`
- `apps/web/src/features/dashboard/summary.ts`
- `apps/web/src/features/dashboard/summary.test.ts`
- `apps/web/src/features/dashboard/bar-chart.tsx`
- `apps/web/src/features/dashboard/stat-tile.tsx`
- `apps/web/src/routes/_auth/dashboard.tsx`
- `docs/test-coverage.md`
- `docs/open-questions.md`

## Out of scope

- **Any change to the paginated list endpoints.** Phase 7a owns those and they are done.
- **Cross-currency FX.** Separate task (`phase-7c`). The summary groups by currency and must keep working unchanged when FX lands, but nothing here anticipates it.
- **A charting dependency.** None is declared in `docs/development/tech-stack.md`, and two bar charts do not justify adding one — inline SVG covers it. If a later screen needs axes, scales, tooltips, and legends, that is the point to propose a library, not now.
- **A configurable date range or a range picker.** The activity window is fixed at 30 days. A selector is speculative until someone asks to change the window.
- **Real-time updates / polling.** The dashboard reads once per mount, like every other screen.

## Related docs

- `docs/adr/0002-money-representation.md` — aggregate totals are `bigint` minor units in the repository and decimal strings on the wire; no `bigint` reaches the serializer
- `docs/adr/0005-tenant-isolation.md` — the procedure takes no organization id; every aggregate is `org_id`-filtered
- `docs/product/roles-and-permissions/ledger.md` — a read open to both `admin` and `viewer`
- `docs/open-questions.md` — #7's note that a client can no longer count accounts from a list

## External sources

- Task/issue: N/A: no external tracker configured (open question #12)
- Product documentation: N/A: local only, `docs/product/requirements/ledger.md`
- Design: N/A: no design source configured

## Acceptance criteria

- `dashboard.summary` returns, in one call: per-currency `accountCount` / `normalTotal` / `externalTotal`; whole-org `accountCount`, `transactionCount`, `reversalCount`, `rejectionCount`; and a daily activity series of `date` / `currency` / `transactionCount` / `debitVolume`.
- Every money field is a decimal string with its currency. No `bigint` and no JSON number reaches the wire.
- The issued query count is **constant** — it does not grow with the number of accounts, transactions, or currencies. Pinned by a test that wraps `pool.query` and compares an org with a handful of rows against one with many.
- `normalTotal + externalTotal === 0` per currency for any org reachable through the ledger's write path. Pinned by a test over a multi-currency, multi-leg, partly-reversed org.
- A transaction with more than two legs contributes its **debit total once**, not once per leg — the join must not multiply the count or the volume.
- An org with no activity returns zeroed totals and empty arrays, not an error and not `null`.
- `reversalCount` counts reversing transactions; a reversal is still a transaction, so `transactionCount` includes it. The dashboard labels both so the relationship is not ambiguous.
- The summary is org-scoped: an org never sees another's figures. Covered by extending the existing no-org-input test and a dedicated isolation assertion.
- The dashboard renders loading, empty, and error states distinctly, and its account count no longer comes from a page.
- Charts are readable in both light and dark themes, degrade to a stated empty state with no data, and carry accessible text alternatives rather than being SVG-only.
- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Task files are working records. When this task reaches `Done`, `Cancelled`, or `Superseded`, move it from `docs/tasks/` to `docs/tasks/archive/2026/`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — any authenticated member of an org, `admin` or `viewer`
- [x] Entry point defined — the `/dashboard` route on mount; and `dashboard.summary` directly
- [x] Preconditions described — an active organization and a verified `member` row (`orgProcedure`)
- [x] Happy path described — one call returns every figure the overview needs; the screen renders tiles and two charts
- [x] Error paths described — `403` for no active org or no membership (unchanged middleware); a failed query renders the error state, which is visually distinct from the empty state. There are no user inputs to validate, so there is no `400` path
- [x] Permissions considered — read-only, open to both roles; every aggregate is `org_id`-filtered, and the procedure accepts no organization id (ADR 0005)
- [x] Acceptance criteria written
- [x] Tests defined — see Acceptance criteria: conservation, constant query count, multi-leg double-count, empty org, tenant isolation, plus pure-function tests for the client-side chart scaling
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `dashboard.summary`, no input, output shape enumerated in Acceptance criteria
- [x] Validation described — no caller input to validate. Currency codes read out of the database go through `packages/core`'s parser, as every other repository read does
- [x] Error responses defined — `403 no_active_organization` / `403 insufficient_role` unchanged; no `400`
- [x] Side effects listed — none, it is a read

### Frontend
- [x] Loading state defined — `QueryState` skeleton, as every other screen
- [x] Empty state defined — an org with no accounts gets an invitation to seed the sandbox; charts with no data state that plainly rather than drawing empty axes
- [x] Error state defined — `QueryState`'s error branch, distinct from empty
- [x] Navigation after each action defined — no actions; links out to accounts, transactions, and the sandbox
- [x] Feedback (toast/inline/modal) defined — inline only; nothing here mutates

---

*Started 2026-07-29.*
