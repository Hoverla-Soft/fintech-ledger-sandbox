# Task: Phase 5h — retire `privateData`

## Goal

Delete the Better-T-Stack scaffolding procedure the router's own comment schedules for this phase, now that no console screen consumes it.

Isolated as its own slice because it is a `packages/api` change that draws the backend guards, and because it cannot be done by deletion alone — two tests depend on it, and one of them is load-bearing.

## Status

Done

Human review waived by the user for the remainder of Phase 5.

## Scope (allowed paths)

- `packages/api/src/routers/index.ts`
- `packages/api/src/procedures.test.ts`
- `packages/api/src/routers/no-org-input.test.ts`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-5h-retire-private-data.md`

## Out of scope

- **`apps/web`.** 5b already removed the last consumer; `grep -rn "privateData" apps/web/src` returns only a comment explaining the removal.
- **`healthCheck`.** Kept — the public landing page consumes it as the API status indicator.
- **Any other procedure.** This is a deletion, not a tidy-up.

## Related docs

- `docs/adr/0005-tenant-isolation.md`
- `docs/adr/0009-console-session-and-tenant-model.md`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — `procedures.test.ts` is rewritten, never deleted.** Its `protectedProcedure` case calls `privateData` (line 47), and it is the **only** assertion in the repo exercising `protectedProcedure`'s unauthenticated rejection. Every other procedure sits on `orgProcedure` or `adminProcedure`, both of which compose `requireAuth` *and* `requireOrg` — so a test against one of those would pass even if `requireAuth` were removed entirely, because `requireOrg` re-checks the session itself (`procedures.ts` says so explicitly).

Deleting the case would therefore silently drop the only coverage of a rung of the access ladder. It gets a **test-local protected-only router** instead, built from the exported `protectedProcedure` and driven through the same `contextFor` fixture. The rung stays proven without a production procedure existing solely to prove it.

**D2 — `no-org-input.test.ts` needs both of its pinned values changed, not just one.** Line 70 asserts a procedure count of `14`; line 78 asserts an exact sorted path array containing `"privateData"`. The count becomes `13` and the entry leaves the array. "Confirm the count still holds" would ship a red test — the count is *supposed* to change, and the array is what makes that change meaningful rather than a number nobody reads.

Both assertions are deliberately kept. Their comment calls them "guarding the guard": if introspection ever silently returned nothing, every ADR 0005 assertion in the file would vacuously pass and report green while checking nothing.

**D3 — the API suite's pass count is reported explicitly.** Removing a procedure removes tests. Reporting the count makes a *shrunk* suite visible rather than letting "still green" stand in for "still covering the same ground".

## Acceptance criteria

- `privateData` and its explanatory comment are gone from `packages/api/src/routers/index.ts`.
- `healthCheck` remains and still serves an unauthenticated caller.
- `protectedProcedure`'s 401 rejection is still asserted, through a test-local fixture rather than a production procedure.
- `no-org-input.test.ts` pins `13` procedures and an array without `"privateData"`.
- `grep -rn "privateData" apps/ packages/` returns nothing outside this task's own documentation.
- The api suite's pass count is reported, and is not lower than 232 minus the one removed case.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5g: `check-types` 6/6, `test` 576 passed (73 core + 243 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `check-types` **6/6 green** · `build` **2/2 green** · `test` **576 passed** (73 core + 243 web + 28 db + **232 api**) · migration guard **PASS**. `pnpm lint` — `N/A`.

**The flat api total was hiding two offsetting changes, and D3 is why they were chased rather than accepted.** Per-file:

- `procedures.test.ts` **9 → 10**: the `privateData` 401 case became two — the same rejection through a protected-only fixture, plus a signed-in success case so a fixture that threw for any reason could not masquerade as working coverage.
- `no-org-input.test.ts` **16 → 15**: it generates one case *per procedure* via `it.each(procedures)`, and there is now one fewer procedure.

Net zero. An unexamined "still 232" would have looked like nothing moved, when in fact a generated ADR 0005 assertion disappeared — correctly, but invisibly.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and delete `.claude/.active-task-scope.json`. This is the last slice of Phase 5.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — N/A at runtime: this removes a procedure. The affected actor is any authenticated caller, who loses an endpoint that returned only their own identity.
- [x] Entry point defined — `packages/api`'s router surface.
- [x] Preconditions described — no consumer remains in `apps/web` (verified by grep; 5b removed it).
- [x] Happy path described — the procedure is gone and every remaining rung of the access ladder is still asserted.
- [x] Error paths described — the one behaviour at risk is `protectedProcedure`'s 401, preserved by D1.
- [x] Permissions considered — none change. `privateData` returned only the caller's own id and no org-scoped data, which is why it was safe to leave in place until now.
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — one procedure **removed**: `privateData`. No procedure added or changed.
- [x] Validation described — N/A: it took no input.
- [x] Error responses defined — N/A: the removed procedure had no error branches of its own.
- [x] Side effects listed — none. It was a read returning the caller's own session id.

### Frontend
- [x] Loading state defined — N/A: no UI in this slice, and `apps/web` is out of Scope.
- [x] Empty state defined — N/A: same.
- [x] Error state defined — N/A: same.
- [x] Navigation after each action defined — N/A: same.
- [x] Feedback defined — N/A: same.

---

*Started 2026-07-28. Phase 5 slice 8 of 8 — the last.*
