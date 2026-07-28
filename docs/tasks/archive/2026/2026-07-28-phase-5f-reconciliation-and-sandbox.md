# Task: Phase 5f — reconciliation and sandbox controls

## Goal

Ship the correctness verifier and the one destructive operation, **together**.

They are one slice rather than two because a failed reset surfaces as `422 unbalanced_transaction`, and that is not a form error — it means the compensating entry did not balance, which is a reconciliation alarm. `docs/adr/0008-sandbox-reset.md` is explicit that reset *refuses* rather than destroying evidence. An alarm needs a live destination to send the user to, so reconciliation has to exist in the same slice that can raise it.

## Status

Done

Human review waived by the user 2026-07-28 for the remainder of Phase 5.

## Scope (allowed paths)

**`apps/web` — the screens:**

- `apps/web/src/routes/_auth/reconciliation.tsx`
- `apps/web/src/routes/_auth/sandbox.tsx`
- `apps/web/src/features/reconciliation/**`
- `apps/web/src/features/sandbox/**`
- `apps/web/src/components/shell/**`
- `apps/web/src/routeTree.gen.ts`

**Documentation:**

- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-5f-reconciliation-and-sandbox.md`

### Hard naming constraint

**No file added by this task may contain `seed` as a `.`/`_`/`-`-delimited token in its basename.** Verified against the hook sources, not assumed:

- `.claude/guard-routes.json:36` routes `**/seed*.*` to three **backend** guards, and it is listed *before* the `apps/web/**` row at line 50. First match wins, so a file named `seed-panel.tsx` would draw `database-migration-guard`, `db-architecture-guard`, and `backend-reliability-security-guard` — and **no frontend guard at all**.
- `.claude/scripts/migration-integrity-guard.js` tests `/(^|[._-])seed([._-]|$)/` against the basename and is a **blocking** `PostToolUse` hook. It matches `sandbox-seed.tsx` (the `-seed.` token), which would run a full-repo Drizzle journal validation on every single edit to that file.

Names actually shipped: `reset-loop.ts`, `sandbox-controls.tsx`, `scenario-outcomes.tsx`, `drift.ts`. (An earlier draft of this section also listed `scenario-run.ts`; the scenario run turned out to need no module of its own — it is a single `client.sandbox.seed` call inside `sandbox-controls.tsx`, with only the *outcome rendering* worth extracting.)

## Out of scope

- **`apps/web/src/lib/ledger/**`.** 5a's kernel is closed; `idempotency.ts` is consumed as-is for both run keys.
- **Audit and rejections.** 5g. This slice links to reconciliation, not to the audit log.
- **New `packages/ui` primitives.** Everything needed already exists.
- **Any change to `sandbox.seed` or `sandbox.reset`.** The chunked reset protocol is `packages/api`'s and is driven, not modified.

## Related docs

- `docs/adr/0008-sandbox-reset.md`
- `docs/adr/0003-balance-and-concurrency.md`
- `docs/adr/0007-rate-limiting.md`
- `docs/backend/api-flow.md`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — reconciliation is a user-triggered button, not a poll.** `docs/adr/0003-balance-and-concurrency.md` treats reconciliation as an invariant a caller may assert at any time, deliberately *not* a scheduled sweep. A console that polled it would imply the ledger needs watching; it does not. The route is open to **both roles** — `reconciliation.verify` sits on `orgProcedure`, and the API's own comment says catching drift is not a privileged operation.

**D2 — the drift is shown, not just a boolean.** `reconciliationSchema` carries `recordedBalance`, `computedBalance`, and `reconciled` per account. Rendering only `allReconciled` would throw away the one thing an operator needs when it is false: *which* account and *by how much*. The headline is the server-derived `allReconciled`; the table is the evidence.

**D3 — the reset loop is a pure, tested driver, and the button is disabled for its whole duration.** `sandbox.reset` returns `remaining`, and the caller loops until it is `0` (`ADR 0008`). Two things follow. The loop lives in `features/sandbox/reset-loop.ts` as a pure function over a `call` callback, so its termination, chunking, and pause behaviour are testable without a network. And the button stays disabled across *every* iteration, not per-request: two concurrent resets racing each other surface as a misleading `422 insufficient_funds`, which reads as a ledger problem rather than the double-click it actually is.

**D4 — a mid-loop `429` pauses and resumes under the same run key; it does not restart.** Rate limits are `60/min/org` and `30/min/user`, charged per chunk (`ADR 0007`), so a few hundred accounts can throttle the loop against itself. `retryAfterSeconds` arrives in the body — there is no `Retry-After` header. Restarting with a fresh key would re-post the chunks already applied.

**D5 — `insufficient_funds` from a scenario is rendered as an expected rejection, not a failure.** The seed set deliberately includes one scenario that must be refused, and `sandbox.seed` reports it as `outcome: "rejected"` with a reason. Rendering that in red as an error would misreport the suite as broken when it is behaving exactly as designed (`docs/backend/api-flow.md`).

**D6 — `422 unbalanced_transaction` from reset is surfaced as a reconciliation alarm with a link, not as a generic form error.** This is the reason the two screens ship together (see Goal).

**D7 — the UI states plainly that reset grows history rather than erasing it.** `ADR 0008` says so directly: *"reset grows history rather than shrinking it… a console showing recent activity will show reset's own compensating entries, which is honest but is not what 'reset' suggests to a user, and Phase 5 should label it accordingly."* This slice is that labelling. Accounts stay, stay active, and finish at zero; the transaction count goes **up**.

**D8 — "resume this run" and "start a new run" are two explicitly labelled intents.** Both seed and reset take a caller-supplied key. Resuming replays under the same key; starting over mints a fresh one. Leaving that implicit means a user cannot tell whether they are about to replay or to re-post, and for reset the answer changes what happens to their balances.

## Design

### Reconciliation

Headline `allReconciled`, then a per-account table of recorded vs computed with the difference shown. Both roles. A refresh button, no polling.

### Sandbox

Two panels, admin-only:

- **Run scenarios** — posts the seed set, then a per-scenario outcome table over the six ids. Replaying appends another rejection audit entry each time, which the UI says (`ADR 0008`).
- **Reset** — drives the chunked loop to `remaining === 0`, showing progress across calls, and states D7's honest description of what reset means.

## Acceptance criteria

- The reset loop issues exactly the calls the protocol requires: fed `{99,150} → {99,51} → {51,0}` it makes **three** calls and no fourth; `{0,0,[]}` terminates immediately as a no-op.
- A mid-loop `429` pauses for `retryAfterSeconds` and resumes **under the same run key**, without restarting.
- A `422 unbalanced_transaction` halts the loop and surfaces as a reconciliation alarm linking to `/reconciliation`.
- The loop reports cumulative progress (accounts zeroed, calls made) rather than only the last response.
- The reset control is provably disabled for the loop's whole duration, not per request.
- Reconciliation renders `allReconciled` as the headline and per-account recorded vs computed with the drift; it is reachable by a viewer.
- A scenario reporting `{outcome: "rejected", reason: "insufficient_funds"}` renders as an **expected** rejection, visually distinct from a failure.
- The sandbox screen states that reset appends compensating entries, deletes nothing, and leaves accounts active at zero.
- No file added by this task matches the `seed` token traps documented above.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5e: `check-types` 6/6, `test` 535 passed (73 core + 202 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `check-types` **6/6 green** · `build` **2/2 green** · `test` **564 passed** (73 core + **231 web** + 28 db + 232 api) · migration guard **PASS**. `pnpm lint` — `N/A`. Backend suites untouched; the +29 are all `apps/web` (12 reset loop, 11 drift, 6 scenario outcomes). `git status apps/web/src/lib/` is empty — 5a's kernel stayed closed.

**Naming constraint audited, not assumed.** Every file added under `features/sandbox/` and `features/reconciliation/` was tested against both trap patterns — the `**/seed*.*` glob from `guard-routes.json` and the `/(^|[._-])seed([._-]|$)/` basename regex from `migration-integrity-guard.js`. None matches. Files shipped: `reset-loop.ts`, `sandbox-controls.tsx`, `scenario-outcomes.tsx`, `drift.ts`.

**Manual demo** (requires `pnpm db:start` and `pnpm dev`):
1. Run scenarios on a fresh org → 6 accounts, 5 scenarios, one reported as an expected rejection.
2. Reconciliation → `allReconciled` true, every account matching.
3. Reset → progress across chunks, stopping at `remaining: 0`; accounts remain, active, at zero.
4. Reconciliation again → still clean.
5. History → shows reset's own compensating entries, exactly as the sandbox screen warned.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and **delete `.claude/.active-task-scope.json`**.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — reconciliation is open to viewer and admin; seeding and resetting are admin-only (`adminProcedure`).
- [x] Entry point defined — `/reconciliation` and `/sandbox` via the shell nav.
- [x] Preconditions described — a verified active org. Reconciliation works on an empty org; reset is a no-op on one.
- [x] Happy path described — run scenarios → verify clean → reset to zero → verify still clean.
- [x] Error paths described — `422 unbalanced_transaction` (D6), mid-loop `429` (D4), `insufficient_role`, `idempotency_conflict`, plus load failures.
- [x] Permissions considered — reconciliation deliberately unguarded by role; sandbox controls hidden for viewers with `403 insufficient_role` handled regardless.
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: no procedure is added or changed. Consumes `reconciliation.verify`, `sandbox.seed`, `sandbox.reset`, `accounts.list`.
- [x] Validation described — both sandbox procedures take only an idempotency key, produced by 5a's module; there is no user-entered value to validate.
- [x] Error responses defined — the branch list above, via `describeFailure`.
- [x] Side effects listed — seeding creates accounts and posts transactions; reset posts compensating transactions and may open a suspense account per currency. Both write audit entries. **Nothing is ever deleted** (invariant #8).

### Frontend
- [x] Loading state defined — skeletons on reconciliation and on the account list; the reset control shows per-chunk progress rather than an indeterminate spinner.
- [x] Empty state defined — an org with no accounts gets "nothing to reconcile yet" pointing at the sandbox screen.
- [x] Error state defined — distinct from empty with retry; the reset alarm is its own state linking to reconciliation.
- [x] Navigation after each action defined — scenarios run → outcome table in place; reset complete → summary in place; alarm → `/reconciliation`.
- [x] Feedback defined — toast on completion; per-chunk progress during the loop; expected rejections rendered distinctly from failures.

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it.*

*Phase 5 slice 6 of 8. Predecessors: 5a–5e (all Done). Successors: 5g audit · 5h retire `privateData`.*
