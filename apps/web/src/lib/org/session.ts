import { canWrite, type LedgerRole } from "@fintech-ledger-sandbox/api/auth/roles";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/**
 * Reading and changing the acting organization.
 *
 * The active org is **session state owned by Better Auth**, never application
 * state. ADR 0005 makes the server derive `orgId` from a `member` row it has
 * verified; a client-side copy could disagree with that, and the disagreement
 * would be invisible until a query returned another tenant's emptiness. So
 * nothing here caches the org — every helper reads through Better Auth's own
 * atoms, which the plugin invalidates on `setActive`, `create`, and `sign-out`.
 */

export interface ActiveOrg {
  readonly id: string;
  readonly name: string;
}

/** The caller's org context, as far as the client can know it. */
export interface OrgContext {
  readonly org: ActiveOrg | null;
  readonly role: LedgerRole;
  readonly canWrite: boolean;
  readonly isPending: boolean;
}

/**
 * The active organization and the caller's role in it.
 *
 * `role` now comes from `session.context`, which returns what `requireOrg`
 * resolved for this request — the same derivation every write is authorized by.
 * It used to be re-derived here by running the shared `toLedgerRole` over Better
 * Auth's member row, which worked but kept two copies of one rule and could go
 * stale in a way the server's per-request lookup never does (open question #1).
 *
 * Still an affordance hint, and that has not changed: this decides what the UI
 * offers, never what the API permits. Fail-closed to `viewer` until the answer
 * arrives, so a slow or failed read hides write affordances rather than
 * showing ones the server would refuse.
 */
export function useOrgContext(): OrgContext {
  const { data: organization, isPending: orgPending } = authClient.useActiveOrganization();
  const { data: context, isPending: contextPending } = useQuery(
    orpc.session.context.queryOptions({ input: {} }),
  );

  const role: LedgerRole = context?.role ?? "viewer";

  return {
    org: organization ? { id: organization.id, name: organization.name } : null,
    role,
    canWrite: canWrite(role),
    isPending: orgPending || contextPending,
  };
}

/**
 * Every organization this user belongs to — the switcher's data source, and
 * the check for whether they have any at all.
 */
export function useOrganizations() {
  return authClient.useListOrganizations();
}

/**
 * Switches the acting organization.
 *
 * **Wiping the cache is not optional.** TanStack Query keys are built from
 * the procedure path and its input, and no ledger procedure takes an `orgId`
 * (`packages/api/src/routers/no-org-input.test.ts` asserts none ever will). So
 * `accounts.list` in org A and `accounts.list` in org B are the *same key*.
 * Without a wipe, switching orgs renders the previous tenant's accounts and
 * balances from cache — data the server would never have sent — until each
 * query happens to refetch.
 *
 * `resetQueries`, deliberately not `clear`. `clear()` removes queries from
 * the cache but does **not** refetch actively-observed ones — a component
 * that stays mounted through the switch (the sidebar's integrity seal is the
 * standing example) keeps rendering the removed query's last result, showing
 * the previous org's data until a full reload. `resetQueries` drops every
 * query's data *and* refetches the active ones under the new session, which
 * is the whole point of the switch. `signOutAndClear` below keeps `clear()`
 * on purpose: sign-out navigates out of the console, so nothing stays
 * mounted, and a reset there would fire unauthenticated refetches instead.
 *
 * `router.invalidate` then re-runs route loaders and guards, so a route that
 * is no longer reachable under the new org re-evaluates instead of sitting
 * there rendering stale context.
 */
export async function switchOrganization(
  organizationId: string,
  queryClient: QueryClient,
  invalidateRouter: () => Promise<void> | void,
): Promise<void> {
  await authClient.organization.setActive({ organizationId });
  await queryClient.resetQueries();
  await invalidateRouter();
}

/**
 * Signs out and drops every trace of the session's data.
 *
 * The cache clear matters as much here as on a switch, and was missing
 * entirely before this slice: signing out navigated away but left every
 * org-scoped response resident in memory, so the next user to sign in on the
 * same tab could be served the previous user's balances out of cache before
 * their own first refetch resolved.
 */
export async function signOutAndClear(
  queryClient: QueryClient,
  invalidateRouter: () => Promise<void> | void,
): Promise<void> {
  await authClient.signOut();
  queryClient.clear();
  await invalidateRouter();
}
