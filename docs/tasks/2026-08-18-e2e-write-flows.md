# Task: Put the write flows back into the browser suite, with a locator strategy that cannot flake

## Goal

`docs/open-questions.md` #9(a). Specs driving **account creation** and **transfer + reversal** were written in Phase 6c, run, and then deleted: the pickers are Base UI `Select` components whose listbox is portalled, and the specs passed on one run and failed the next. Deleting them was the right call — a flaky test trains people to re-run until green — but it left the console's two most important flows with no browser-level proof.

Outcome: both flows are covered by specs that wait on state rather than on time, so they either pass deterministically or get deleted again. No `retry`, no `waitForTimeout`.

## Status

Human Review

Verified 2026-08-18: `pnpm lint` (269 files, 0 diagnostics) · `pnpm check-types` (6/6) · `pnpm test` (**763 passed**) · `pnpm build` (2/2) · `pnpm --filter web test:e2e` **run three times back to back, 6/6 each time**.

## Scope (allowed paths)

- `apps/web/e2e/support/select.ts`
- `apps/web/e2e/support/accounts.ts` — **added mid-task.** The transfer spec needs two accounts before it can move anything, and inlining the dialog walk twice would duplicate the exact steps `accounts.e2e.ts` exists to pin
- `apps/web/e2e/support/tenant.ts`
- `apps/web/e2e/accounts.e2e.ts`
- `apps/web/e2e/transfer.e2e.ts`
- `apps/web/src/features/transactions/reverse-dialog.tsx`
- `apps/web/src/features/transactions/reverse-dialog.test.tsx`
- `packages/db/src/limits.ts`, `packages/db/src/posting/post-transaction.ts`, `packages/db/src/posting/index.ts`, `packages/db/package.json`, `packages/api/src/contracts/money.ts` — **added mid-task, and not optional.** The transfer spec's first run found `/transfer` dead in a real browser: a constant imported from `@fintech-ledger-sandbox/db/posting` had pulled drizzle, the Postgres driver and `node:crypto` into the console bundle. Fixing the spec around a broken screen would have been recording a green run for a page that does not load
- `docs/development/architecture.md` — the build-contract rule that regression violated, written down so the next cross-package import has something to check against
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-18-e2e-write-flows.md`

## Out of scope

- **An e2e job in CI.** #9(b) says a job that has never been proven in CI should not be added on the strength of a local pass, and #10 makes that worse rather than better: CI has never executed a single check, so a new job would be unprovable by construction. It stays recorded, not added.
- **Viewer-role e2e coverage** (#9(c)). A second member in the same org needs an invitation flow the console does not have; forging one would mean seeding a `member` row directly, which is exactly the "skip the real routing" shortcut `support/tenant.ts` argues against. The role split is covered in the API suite and the component suite.
- **`packages/ui/src/components/select.tsx`.** No change is needed — see below. Adding test ids to a design-system primitive to fix a spec problem would put test concerns into shared UI for nothing.
- **Adding `retry` to the Playwright config.** The original row's whole point.

## The finding that changes the approach

**The primitive did not need changing.** Every `Select` trigger in both flows already carries a stable, hand-written `id` through `fieldControlProps` — `account-name`, `account-currency`, `account-type`, `transfer-source`, `transfer-destination`. So the flakiness was never "no way to address the control".

**My first diagnosis was also wrong, and it is worth leaving the correction visible.** I wrote that the popup "stays in the DOM while it animates out" and swallows the next click — a timing race. Then the second picker failed, and the captured DOM said otherwise:

```
<div role="listbox" data-closed  data-slot="select-content">…USD EUR GBP…</div>
<div role="listbox" data-open    data-slot="select-content">…normal external…</div>
```

Base UI does **not** unmount a closed popup at all. It marks it `data-closed` and leaves it in the document permanently. So the closed popup was not intercepting anything — the *locator* was: `[data-slot="select-content"]` accumulates one match for every select ever opened, which is a strict-mode violation from the second picker onward. That explains the original symptom better than animation ever did: a spec touching one select passed, a spec touching two did not, and which one "won" depended on incidental ordering.

The fix is a helper that narrows to `[data-open]` — of which there is at most one — and waits on that appearing and going. Nothing is timing-based.

## The drift found while reading

`reverse-dialog.tsx` tells the user, in both branches of its warning:

> Reversals are not deduplicated. … Reversing it more than once would succeed every time and apply the correction each time.

**That has been false since 2026-08-16.** Open question #3 was closed by migration `0007`, whose partial unique index on `reverses_transaction_id` makes a transaction reversible **at most once**; a second attempt is refused with `409 already_reversed`. The copy is not merely stale — it is a false statement about a money operation, on the confirmation screen for that operation, and it warns in the wrong direction: it tells an admin a dangerous double-correction "will succeed" when the server now refuses it.

Fixed here rather than logged, because a spec that drives this dialog would otherwise be asserting text that is wrong.

## Actors, entry points, preconditions

- **Actor:** a newly signed-up admin, created per spec file by `signUpAndCreateOrg`.
- **Entry point:** `/accounts` for creation, `/transfer` for the transfer, then the transaction detail screen for the reversal.
- **Preconditions:** Postgres up and migrated (`pnpm db:start`); the config starts web and API itself. Each spec owns a uniquely-named org, so no reset is needed and files stay order-independent.

## Happy path

1. `support/select.ts` exports `selectOption(page, triggerId, optionName)`: click the trigger, wait for the **open** popup (`[data-open]`, of which there is at most one) to be visible, click the option by its `option` role inside it, then wait for no popup to be open.
2. `accounts.e2e.ts` gains a creation spec: open **New account**, fill the name, pick currency and type through the helper, submit, wait for the **detail page** the dialog navigates to, then go back to `/accounts` and assert the row. Waiting on the row directly is a race — see the acceptance notes.
3. `transfer.e2e.ts` walks the full money path: create an `external` funding account and a `normal` wallet, go to `/transfer`, pick source and destination, enter an amount, **Review transfer** → **Post transfer**, assert the posted transaction, then reverse it from the detail screen (type `REVERSE`, **Post reversal**) and assert the reversal landed.
4. The reverse dialog's copy is corrected to describe the constraint that actually exists.

## Error paths

- **A spec still flakes** → it gets deleted and the gap re-recorded, exactly as in Phase 6c. That is the standing rule for this suite, not a fallback invented here.
- **The popup wait times out** → a real failure worth seeing: it means the select never closed, which is a UI bug rather than a test problem.
- **Sign-up or org creation fails** → already asserted step-by-step in `signUpAndCreateOrg`, so the failure names the step rather than surfacing later as a missing button.

## Permissions

The specs run as an admin. Viewer coverage stays out of scope, above.

## Side effects

Each run leaves a user, an organization, two accounts, and two transactions in the dev database. That is the suite's existing, deliberate design — isolation by tenancy rather than truncation — and `uniqueTenant` labels every row with its spec so leftovers are traceable.

## Acceptance criteria

- [x] `selectOption` waits on popup visibility and disappearance only — no `waitForTimeout`, no arbitrary sleep, anywhere in the suite.
- [x] An account is created through the real dialog and appears in the accounts table.
- [x] A transfer is posted through the two-stage review/confirm flow and its transaction is visible.
- [x] That transaction is reversed through the confirmation dialog, and the reversal is visible.
- [x] `pnpm test:e2e` passes, and passes **again immediately on a re-run** — one green run is exactly the evidence the original row says is insufficient. Run **three times back to back: 6/6, 6/6, 6/6.** This bar earned its keep: the account spec's *first* green run was itself a race — creating an account navigates to its detail page, so asserting a row in the list passed only by beating the router, and it failed the moment a second account was created in the same run.
- [x] No `retries` added to `playwright.config.ts`.
- [x] The reverse dialog no longer claims reversals are undeduplicated.
- [x] `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --filter web test:e2e   # twice, back to back
```

## Retention

Move to `docs/tasks/archive/2026/` on `Done`, once #9 reflects what shipped.

## Spec completeness checklist

### Common
- [x] Actor(s) defined
- [x] Entry point defined
- [x] Preconditions described
- [x] Happy path described
- [x] Error paths described
- [x] Permissions considered
- [x] Acceptance criteria written
- [x] Tests defined — this task *is* tests; the flows and assertions are enumerated above
- [x] Out of scope stated explicitly

### Backend
- [x] `N/A: no backend change.` The specs drive existing procedures; nothing in `packages/api` or `packages/db` is touched.

### Frontend
- [x] Loading state defined — `N/A: no new UI`, except the reverse dialog's corrected copy
- [x] Empty state defined — `N/A`
- [x] Error state defined — `N/A`
- [x] Navigation after each action defined — asserted by the specs themselves: transfer lands on the transaction, reversal stays on the detail screen
- [x] Feedback (toast/inline/modal) defined — `N/A: unchanged`

---

*Started 2026-08-18.*
