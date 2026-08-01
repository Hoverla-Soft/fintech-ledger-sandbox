import type { QueryClient } from "@tanstack/react-query";

import { canWrite, type LedgerRole, toLedgerRole } from "@fintech-ledger-sandbox/api/auth/roles";

import { authClient } from "@/lib/auth-client";

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
 * `role` is an affordance hint only (open question #1). Fail-closed to
 * `viewer` while the member row is loading.
 */
export function useOrgContext(): OrgContext {
  const { data: organization, isPending: orgPending } = authClient.useActiveOrganization();
  const { data: member, isPending: memberPending } = authClient.useActiveMember();

  const role = toLedgerRole(member?.role);

  return {
    org: organization ? { id: organization.id, name: organization.name } : null,
    role,
    canWrite: canWrite(role),
    isPending: orgPending || memberPending,
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
 * **Clearing the cache is not optional.** TanStack Query keys are built from
 * the procedure path and its input, and no ledger procedure takes an `orgId`
 * (`packages/api/src/routers/no-org-input.test.ts` asserts none ever will). So
 * `accounts.list` in org A and `accounts.list` in org B are the *same key*.
 * Without a clear, switching orgs renders the previous tenant's accounts and
 * balances from cache — data the server would never have sent — until each
 * query happens to refetch.
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
  queryClient.clear();
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
