import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState, QueryState } from "@/components/states";
import { canTransfer } from "@/features/transfer/eligibility";
import { TransferForm } from "@/features/transfer/transfer-form";
import { useOrgContext } from "@/lib/org/session";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transfer")({
  component: TransferRoute,
});

function TransferRoute() {
  const accounts = useQuery(orpc.accounts.list.queryOptions());
  const { canWrite } = useOrgContext();

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">New transfer</h1>
        <p className="text-sm text-muted-foreground">
          Money leaves one account and arrives in another. Both legs are posted together or not at
          all.
        </p>
      </div>

      {!canWrite ? (
        <p className="rounded-none border border-dashed p-6 text-center text-sm text-muted-foreground">
          Posting a transfer needs an admin role in this organization.
        </p>
      ) : (
        <QueryState
          query={accounts}
          loadingRows={3}
          empty={{
            // Deliberately not `length === 0`: an org holding one USD account
            // and one JPY account has two accounts and can still transfer
            // nothing, so the empty state has to say something true.
            isEmpty: (data) => !canTransfer(data.accounts),
            render: (
              <EmptyState
                title="Nothing to transfer between yet"
                description="A transfer needs two open accounts in the same currency."
                action={
                  <Button variant="outline" render={<Link to="/accounts" />}>
                    Go to accounts
                  </Button>
                }
              />
            ),
          }}
        >
          {(data) => <TransferForm accounts={data.accounts} />}
        </QueryState>
      )}
    </div>
  );
}
