import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

/**
 * The public landing page.
 *
 * Carries its own minimal chrome rather than the console shell — that shell
 * renders an organization switcher, which is meaningless to a signed-out
 * visitor.
 *
 * The Better-T-Stack ASCII banner was removed here in Phase 5b; it named the
 * scaffold rather than the product and was the first thing anyone opening this
 * console saw.
 */
function HomeComponent() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 py-2">
        <span className="font-medium">Ledger sandbox</span>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </header>

      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-3xl font-bold">Double-entry ledger sandbox</h1>
          <p className="mt-2 text-muted-foreground">
            Fake money, real correctness. Every transfer is a balanced set of postings, balances
            always reconcile with their posting history, transfers are idempotent, and no
            organization can see another&apos;s data.
          </p>
        </div>

        <section className="rounded-none border p-4">
          <h2 className="mb-2 font-medium">API status</h2>
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                healthCheck.isPending
                  ? "bg-muted-foreground"
                  : healthCheck.data
                    ? "bg-emerald-500"
                    : "bg-destructive"
              }`}
            />
            <span className="text-sm text-muted-foreground">
              {healthCheck.isPending ? "Checking…" : healthCheck.data ? "Connected" : "Disconnected"}
            </span>
          </div>
        </section>

        <Button render={<Link to="/dashboard" />}>Open the console</Button>
      </div>
    </div>
  );
}
