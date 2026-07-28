import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState, QueryState } from "@/components/states";
import { useOrgContext } from "@/lib/org/session";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardRoute,
});

/**
 * The console overview.
 *
 * Rewritten in Phase 5b off the Better-T-Stack `privateData` scaffold and onto
 * a real org-scoped read. That swap is the point of this slice: `accounts.list`
 * runs on `orgProcedure`, so before `organizationClient()` was wired it
 * returned `403 no_active_organization` for every browser user. If the count
 * below renders, tenancy works end to end — session → active org → verified
 * `member` row → org-filtered query.
 *
 * The account *count* is deliberately all this shows. Phase 5c owns the real
 * accounts screen and replaces this with the list; anything richer here would
 * be thrown away.
 */
function DashboardRoute() {
  const { org, role } = useOrgContext();
  const accounts = useQuery(orpc.accounts.list.queryOptions());

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{org?.name ?? "Console"}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium">{role}</span>.
          {role === "viewer" ? " You have read access to this organization." : null}
        </p>
      </div>

      <section className="rounded-none border p-4">
        <h2 className="mb-3 font-medium">Accounts</h2>
        <QueryState
          query={accounts}
          loadingRows={3}
          empty={{
            isEmpty: (data) => data.accounts.length === 0,
            render: (
              <EmptyState
                title="No accounts yet"
                description="An account is a named balance in one currency. Seed the sandbox or create one to get started."
                action={
                  <Button variant="outline" render={<Link to="/organization" />}>
                    Manage organizations
                  </Button>
                }
              />
            ),
          }}
        >
          {(data) => (
            <p className="text-sm">
              <span className="text-2xl font-semibold">{data.accounts.length}</span>{" "}
              <span className="text-muted-foreground">
                {data.accounts.length === 1 ? "account" : "accounts"} in this organization
              </span>
            </p>
          )}
        </QueryState>
      </section>
    </div>
  );
}
