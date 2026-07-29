import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState, QueryState } from "@/components/states";
import { canExchange } from "@/features/exchange/conversion";
import { ExchangeForm } from "@/features/exchange/exchange-form";
import { useOrgContext } from "@/lib/org/session";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/exchange")({
  component: ExchangeRoute,
});

/** Matches the transfer screen's picker ceiling, for the same reason recorded there. */
const PICKER_LIMIT = 200;

function ExchangeRoute() {
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { limit: PICKER_LIMIT } }));
  const { canWrite } = useOrgContext();

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div>
        <h1 className="font-bold text-2xl">Currency exchange</h1>
        <p className="text-muted-foreground text-sm">
          Money leaves one currency and arrives in another at a rate you state. Both halves are
          posted together or not at all.
        </p>
      </div>

      {!canWrite ? (
        <p className="rounded-none border border-dashed p-6 text-center text-muted-foreground text-sm">
          Posting an exchange needs an admin role in this organization.
        </p>
      ) : (
        <QueryState
          query={accounts}
          loadingRows={4}
          empty={{
            // Deliberately not `length === 0`, and deliberately the opposite test
            // from the transfer screen's: an exchange needs two active accounts in
            // *different* currencies, where a transfer needs two in the same one.
            // An org with two USD accounts can transfer and cannot exchange.
            isEmpty: (data) => !canExchange(data.accounts) && data.nextCursor === null,
            render: (
              <EmptyState
                title="Nothing to exchange between yet"
                description="An exchange needs two open accounts in different currencies. Create one in a second currency, or seed the sandbox."
                action={
                  <Button variant="outline" render={<Link to="/accounts" />}>
                    Go to accounts
                  </Button>
                }
              />
            ),
          }}
        >
          {(data) => (
            <>
              {data.nextCursor !== null ? (
                <p role="status" className="rounded-none border border-dashed p-3 text-xs">
                  This organization has more than {PICKER_LIMIT} accounts. The pickers below show
                  the first {PICKER_LIMIT} by name.
                </p>
              ) : null}
              <ExchangeForm accounts={data.accounts} />
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}
