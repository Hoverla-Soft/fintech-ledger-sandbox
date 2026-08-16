# Task: Stale integrity seal after organization switch

## Goal

Switching (or creating) an organization must never leave any mounted component rendering the previous organization's data. Observed: the sidebar integrity seal keeps showing the previous org's "Verified · N accounts" until a full page reload, while freshly-mounted screens (Accounts, etc.) correctly show the new org.

Root cause (traced, not guessed): `switchOrganization` calls `queryClient.clear()`. In TanStack Query v5, `clear()` removes queries from the cache but does **not** refetch actively-observed ones — a mounted observer keeps rendering the removed query's last result. The integrity seal is the only always-mounted org-scoped query (it lives in the persistent sidebar), so it alone survives the switch with stale data; every other query happens to remount on navigation and fetches fresh. The sign-out path (`signOutAndClear`) is *not* affected: navigation to `/login` unmounts the console, so `clear()` is correct there.

## Status

Human Review

## Scope (allowed paths)

- `apps/web/src/lib/org/session.ts`
- `apps/web/src/lib/org/session.test.tsx`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-15-stale-integrity-seal-on-org-switch.md`

## Out of scope

- `signOutAndClear` — `clear()` is correct there (console unmounts; a reset would fire unauthenticated refetches and toast 401s before navigation completes)
- The integrity seal component itself — it is a correct consumer; the defect is in the switch helper all callers share
- Better Auth session handling

## Related docs

- ADR 0005 (tenant isolation) — why the cache must not survive an org switch at all
- `apps/web/src/lib/org/session.ts` — the "Clearing the cache is not optional" comment this fix amends

## External sources

- Task/issue: N/A: found during showcase GIF recording in this repo, no external tracker entry
- Product documentation: N/A: all sources local
- Design: N/A: no visual change

## Acceptance criteria

- A query that is **mounted during the switch** refetches and renders the new organization's data without a reload.
- A query that is **not mounted** during the switch holds no data from the previous organization afterwards.
- Regression test covers both, failing against the `clear()` implementation and passing against the fix.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm --filter web test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` when Done.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — a signed-in user switching or creating an organization in the console
- [x] Entry point defined — org switcher menu item, or the organization page's create form (both call `switchOrganization`)
- [x] Preconditions described — user belongs to ≥2 orgs, or creates a second; some org-scoped query mounted in the persistent shell
- [x] Happy path described — switch → every mounted org-scoped query refetches under the new org
- [x] Error paths described — a failed refetch renders the query's normal error state ("Integrity unknown" for the seal); no stale data either way
- [x] Permissions considered — unchanged; server still derives org per ADR 0005, this is purely client cache hygiene
- [x] Acceptance criteria written
- [x] Tests defined — mounted-query refetch + unmounted-query wipe, in `session.test.tsx`
- [x] Out of scope stated explicitly

### Backend
- [ ] API endpoints defined — N/A: no backend change
- [ ] Validation described — N/A: no backend change
- [ ] Error responses defined — N/A: no backend change
- [ ] Side effects listed — N/A: no backend change

### Frontend
- [x] Loading state defined — during refetch the seal shows its existing pending state ("Checking…"); no new states introduced
- [ ] Empty state defined — N/A: no new surface; consumers keep their existing states
- [x] Error state defined — existing "Integrity unknown" badge on refetch failure
- [ ] Navigation after each action defined — N/A: navigation behavior unchanged
- [ ] Feedback (toast/inline/modal) defined — N/A: no new feedback; existing toasts unchanged

---

*Started 2026-08-15.*
