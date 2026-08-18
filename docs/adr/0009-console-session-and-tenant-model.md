# ADR 0009 — How the console learns its organization and role

**Status:** Accepted · **Date:** 2026-07-28 · **Phase:** 5b

## Context

ADR 0005 made the acting organization a **server-derived** value. No procedure in `packages/api` accepts an `orgId`; the value comes from `session.activeOrganizationId`, treated as a *claim* until `resolveMembership` finds a matching `member` row. `packages/api/src/routers/no-org-input.test.ts` asserts mechanically that no input schema ever grows one.

That is the right model, and it leaves the console with two questions it cannot answer by asking the API:

1. **Which organization am I acting in, and what else could I switch to?**
2. **Am I an admin or a viewer here?** The role is resolved inside `requireOrg` and lives only in middleware context (`packages/api/src/procedures.ts`). No procedure returns it.

Before this slice the console answered neither. `createAuthClient` was called with no `plugins` array at all (`apps/web/src/lib/auth-client.ts`), so `organizationClient()` was unwired and the string `activeOrganizationId` appeared **zero times** anywhere under `apps/web`. Every `orgProcedure` call from a browser therefore returned `403 no_active_organization` — the entire org-scoped API surface was unreachable from the UI it was built for.

## Decision

**The organization is session state owned by Better Auth. The role is derived client-side from the member row, as an affordance hint only.**

Concretely:

- `organizationClient()` is registered on the client, mirroring the `organization()` plugin the server has had since Phase 1. The active org changes **only** through `authClient.organization.setActive`.
- The console never stores the org in application state. It reads through Better Auth's own atoms (`useActiveOrganization`, `useActiveMember`, `useListOrganizations`), which the plugin invalidates on `setActive`, `create`, and `sign-out`.
- The console imports `toLedgerRole` from `packages/api/src/auth/roles.ts` — `owner`/`admin` → admin, comma-lists take the write role, anything unrecognised (including a missing member row) → `viewer`. Affordance only; writes still enforce on the server.
- Switching organizations and signing out both call `queryClient.clear()`.

## Consequences

- **The role mapping is duplicated.** Two implementations of one rule is a drift risk, mitigated by an agreement test rather than by discipline. Logged as open question #1: a `session.context` procedure returning the resolved org and role would delete the duplicate, and is the right fix when `packages/api` is next open.

- **A hidden button is not a permission.** `docs/product/roles-and-permissions/ledger.md` is explicit — *"'The frontend hides the button' is not enforcement anywhere in this system."* The client's role can be stale in a way the server's never is: the server re-reads `member.role` on **every** org-scoped request, so a demotion takes effect on the caller's next request with no sign-out. Every write path in 5c–5g therefore handles `403 insufficient_role` regardless of what the UI chose to render. Treat the hidden button as a courtesy and the 403 as the truth.

- **Clearing the query cache on switch is mandatory, not hygiene.** TanStack Query keys are built from the procedure path and its input, and *no ledger procedure takes an `orgId`* — that is ADR 0005's whole point. So `accounts.list` under org A and under org B are literally the same cache key. Without the clear, switching organizations renders the previous tenant's accounts and balances from cache, under the new organization's name, until each query happens to refetch. It would look exactly like a tenant-isolation breach in a system whose isolation is in fact intact, which is arguably worse than a real bug: it would destroy trust in the one property this sandbox exists to demonstrate.

  The same applies to sign-out, which did not clear the cache before this slice.

- **`403 no_active_organization` is navigation, not failure.** It is the normal state of a user who has signed up and not yet created an org, so the console routes to `/organization`. `403 not_a_member` is rendered as loss of access and never as "that organization does not exist" — the API returns the same body for both cases precisely so it cannot become an existence oracle for another tenant.

- **Only two of the four boundary states are knowable client-side.** Absent session and absent active org are decided in the route guard. Whether the session's org claim still corresponds to a live `member` row is a fact only the database holds, so `not_a_member` can only ever surface from a real request. This is a property of ADR 0005's design, not a gap.

## Alternatives considered

- **Add a role/context procedure to `packages/api`.** The cleanest long-term answer and the one open question #1 records. Rejected *for this slice* because it reopens `packages/api` inside a frontend task and drags `no-org-input.test.ts`'s pinned procedure count with it — a backend change wearing a frontend slice's clothes.
- **Render every affordance and let `403 insufficient_role` teach.** Honest, and it would have needed no role logic at all. Rejected because a viewer would meet six buttons that all fail, which reads as a broken console rather than a permissions model.
- **Mirror the active org into a client store.** Rejected outright: a client copy can disagree with the server's verified value, and the disagreement surfaces as another tenant's apparent emptiness rather than as an error.

## References

- `docs/adr/0005-tenant-isolation.md`
- `docs/product/roles-and-permissions/ledger.md`
- `packages/api/src/procedures.ts`, `packages/api/src/auth/roles.ts`
- `apps/web/src/lib/org/`, `apps/web/src/routes/_auth/route.tsx`
