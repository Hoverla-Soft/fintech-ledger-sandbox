# Task: Phase 5g — audit log and rejections

## Goal

The last read surface: what happened in this organization, and what was refused.

Small, but it has more ways to mislead than any other screen in the phase. Three of its fields are deliberately untyped or incomplete, and rendering them as if they were neither would state things that are not true.

## Status

Done

Human review waived by the user for the remainder of Phase 5.

## Scope (allowed paths)

- `apps/web/src/routes/_auth/audit.tsx`
- `apps/web/src/features/audit/**`
- `apps/web/src/components/shell/**`
- `apps/web/src/routeTree.gen.ts`
- `packages/ui/src/components/tabs.tsx`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-5g-audit.md`

## Out of scope

- **`apps/web/src/lib/ledger/**`.** 5a's kernel is closed.
- **`privateData`'s removal.** 5h.
- **Adding a cursor to `audit.list`.** That is an API change (open question #6); this slice states the ceiling rather than hiding it.

## Related docs

- `docs/adr/0006-write-endpoint-contract.md`
- `docs/adr/0008-sandbox-reset.md`
- `docs/backend/error-handling.md`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — two tabs over one store, not two screens.** `audit.rejections` is a *filtered read of the same table* (`outcome = 'rejected'`), which the router says explicitly. Presenting them as separate places would imply two logs that could disagree.

**D2 — `action` and `reason` are open strings and are rendered with a fallback, never switched exhaustively.** `auditEntrySchema` types both as `z.string()` — they are not enums, and `packages/api` is free to record an action this console has never heard of. A `switch` with no default would render blank cells for exactly the entries most worth reading: the novel ones.

**D3 — `metadata` is `z.unknown()` and is rendered as read-only JSON with no typed assumption.** Reaching into it for a field that "should" be there is how a log viewer starts throwing on the rows it most needs to display.

**D4 — the 200-entry ceiling is stated in the UI.** There is no cursor on `audit.list` (open question #6), so the log genuinely is not walkable past its most recent 200 entries. A viewer who believes they are seeing everything will draw wrong conclusions from an incomplete log — worse than one who knows the boundary.

**D5 — the copy must not promise account creations.** `accounts.create` writes **no audit entry** (`docs/adr/0006-write-endpoint-contract.md`). A log described as "everything that happened" would be read as evidence that no account was created, which is false. The screen says what the log actually records: transaction posts and refusals.

**D6 — duplicated `insufficient_funds` rejection rows are expected and labelled as such.** Replaying a scenario run appends another rejection entry each time (`docs/adr/0008-sandbox-reset.md`). Without a note, a user seeing five identical refusals concludes something retried five times in error.

**D7 — `limit` is clamped client-side inside `1..200`,** so the `400 {issues}` branch is unreachable from this screen. The branch stays handled through `describeFailure` because the schema allows it.

## Design

One route, `/audit`, open to **both roles** (`orgProcedure`). Tabs switch which procedure is queried — the rejections tab calls `audit.rejections`, it does **not** client-filter the full log, because client-filtering a capped list would silently drop rejections that fell outside the most recent 200 entries.

Columns: time, action, outcome, reason, linked transaction. `metadata` expands per row.

## Acceptance criteria

- An unrecognised `action` string renders without throwing and without a blank cell.
- `metadata` renders for `null`, `undefined`, a primitive, and an arbitrary nested object.
- The rejections tab calls `audit.rejections` rather than filtering the full log client-side.
- The 200-entry ceiling is stated on screen.
- The copy states that account creations are not recorded.
- Repeated identical rejections are explained rather than left to look like a bug.
- Empty and error states are distinct; a viewer can reach the screen.
- An audit nav link exists in the shell.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5f: `check-types` 6/6, `test` 564 passed (73 core + 231 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `check-types` **6/6 green** · `build` **2/2 green** · `test` **576 passed** (73 core + **243 web** + 28 db + 232 api) · migration guard **PASS**. `pnpm lint` — `N/A`.

**A real bug caught by its own test.** `actionLabel` originally looked the action up in an object literal. Because `action` is an untrusted open string, `labels["__proto__"]` returns `Object.prototype` and `labels["toString"]` returns a function — neither is `undefined`, so the `?? action` fallback never fires and the cell renders `[object Object]`. Replaced with a `Map`, which has no prototype chain to fall through. `packages/core`'s currency parser guards the identical hazard with `Object.hasOwn`.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and delete `.claude/.active-task-scope.json`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org viewer and org admin; the log is a read surface open to both.
- [x] Entry point defined — `/audit` via the shell nav.
- [x] Preconditions described — a verified active org. An org with no activity yields an empty log, which is a valid state.
- [x] Happy path described — open the log, switch to rejections, expand an entry's metadata.
- [x] Error paths described — load failure with retry; `400 {issues}` handled though made unreachable (D7).
- [x] Permissions considered — no role gate; `audit.list` and `audit.rejections` both sit on `orgProcedure`.
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: no procedure added or changed. Consumes `audit.list` and `audit.rejections`.
- [x] Validation described — `limit` clamped client-side inside the published range; there is no other input.
- [x] Error responses defined — via `describeFailure`, as everywhere else.
- [x] Side effects listed — none. This slice is read-only.

### Frontend
- [x] Loading state defined — skeleton rows per tab.
- [x] Empty state defined — distinct per tab: an empty log means no activity; an empty rejections tab means nothing was refused, which is good news and is worded as such.
- [x] Error state defined — distinct from empty, with retry.
- [x] Navigation after each action defined — a linked transaction opens its detail; switching tabs changes the query, not the route.
- [x] Feedback defined — no mutations, so no toasts; the ceiling and the account-creation caveat are stated inline.

---

*Started 2026-07-28. Phase 5 slice 7 of 8. Successor: 5h retire `privateData`.*
