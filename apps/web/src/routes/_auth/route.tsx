import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { ConsoleShell } from "@/components/shell/console-shell";
import { authClient } from "@/lib/auth-client";

/**
 * The tenant gate.
 *
 * Two of the four boundary conditions are knowable before any request is made,
 * and this is where they are decided:
 *
 * 1. **No session** → `/login`, carrying a return-to so the user lands where
 *    they were headed instead of being dumped on the console root.
 * 2. **Session with no active organization** → `/organization`. This is not an
 *    error: `docs/product/roles-and-permissions/ledger.md:70` calls it "the
 *    normal state for a user who has signed up but not yet created or joined
 *    an org", and says the console is expected to route them to org creation.
 *
 * The other two are not knowable here, by design. Whether the session's
 * `activeOrganizationId` corresponds to a live `member` row is a fact only the
 * server holds — ADR 0005 makes the client's value a *claim* until a database
 * lookup vouches for it — so `403 not_a_member` can only surface from a real
 * query, and is handled where that query runs.
 */
export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();

    if (!session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }

    // The session's own claim. Never trusted for authorization — every
    // org-scoped request re-derives and re-verifies it server-side — but
    // enough to know whether to send the user to org creation.
    const activeOrganizationId = session.session.activeOrganizationId ?? null;

    // `/organization` is itself a child of this layout, and TanStack Router
    // runs a parent's `beforeLoad` before the child's. Redirecting there
    // unconditionally would re-enter this guard, find no active org again, and
    // redirect forever — a child `beforeLoad` cannot opt out of its parent's.
    // The destination is exempted here rather than by hoisting the route out
    // of the layout, because it genuinely does require a session; it is only
    // the *organization* requirement it must not be held to.
    const isOrganizationRoute = location.pathname.startsWith("/organization");

    if (!activeOrganizationId && !isOrganizationRoute) {
      throw redirect({ to: "/organization" });
    }

    return { session, activeOrganizationId };
  },
});

function AuthLayout() {
  return (
    <ConsoleShell>
      <Outlet />
    </ConsoleShell>
  );
}
