import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@fintech-ledger-sandbox/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState, QueryState } from "@/components/states";
import { canTransfer } from "@/features/transfer/eligibility";
import { FeeSplitForm } from "@/features/transfer/fee-split-form";
import { TransferForm } from "@/features/transfer/transfer-form";
import { useOrgContext } from "@/lib/org/session";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transfer")({
  component: TransferRoute,
});

const PICKER_LIMIT = 200;

function TransferRoute() {
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { limit: PICKER_LIMIT } }));
  const { canWrite } = useOrgContext();

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Move money</h1>
        <p className="text-sm text-muted-foreground">
          Post a two-leg transfer or a three-leg fee split. Legs are committed together or not at
          all.
        </p>
      </div>

      {!canWrite ? (
        <p className="rounded-none border border-dashed p-6 text-center text-sm text-muted-foreground">
          Posting needs an admin role in this organization.
        </p>
      ) : (
        <QueryState
          query={accounts}
          loadingRows={3}
          empty={{
            isEmpty: (data) => !canTransfer(data.accounts) && data.nextCursor === null,
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
          {(data) => (
            <>
              {data.nextCursor !== null ? (
                <p role="status" className="rounded-none border border-dashed p-3 text-xs">
                  This organization has more than {PICKER_LIMIT} accounts. The pickers below show
                  the first {PICKER_LIMIT} by name — an account you expect to see may be outside
                  them.
                </p>
              ) : null}
              <Tabs defaultValue="transfer">
                <TabsList>
                  <TabsTab value="transfer">Transfer</TabsTab>
                  <TabsTab value="fee-split">Fee split</TabsTab>
                </TabsList>
                <TabsPanel value="transfer" className="pt-4">
                  <TransferForm accounts={data.accounts} />
                </TabsPanel>
                <TabsPanel value="fee-split" className="pt-4">
                  <FeeSplitForm accounts={data.accounts} />
                </TabsPanel>
              </Tabs>
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}
