import { Alert, AlertDescription, AlertTitle } from "@fintech-ledger-sandbox/ui/components/alert";
import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fintech-ledger-sandbox/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState, QueryState } from "@/components/states";
import { formatDrift } from "@/features/reconciliation/drift";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/reconciliation")({
  component: ReconciliationRoute,
});

/**
 * Invariant #2, on demand.
 *
 * Deliberately **not** polled. `docs/adr/0003-balance-and-concurrency.md`
 * treats reconciliation as an invariant a caller may assert at any moment
 * rather than a scheduled sweep — correctness is meant to hold continuously as
 * postings write. A console that checked it on a timer would imply the ledger
 * needs supervision.
 *
 * Open to **both roles**: `reconciliation.verify` sits on `orgProcedure`, and
 * a viewer who can already see balances can see everything this returns.
 */
function ReconciliationRoute() {
  const reconciliation = useQuery(orpc.reconciliation.verify.queryOptions());

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Every account&apos;s recorded balance compared against the signed sum of its postings.
            These must always agree.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={reconciliation.isFetching}
          onClick={() => void reconciliation.refetch()}
        >
          {reconciliation.isFetching ? "Checking…" : "Re-check"}
        </Button>
      </div>

      <QueryState
        query={reconciliation}
        loadingRows={5}
        empty={{
          isEmpty: (data) => data.accounts.length === 0,
          render: (
            <EmptyState
              title="Nothing to reconcile yet"
              description="This organization has no accounts, so there are no balances to check."
              action={
                <Button variant="outline" render={<Link to="/sandbox" />}>
                  Open sandbox controls
                </Button>
              }
            />
          ),
        }}
      >
        {(data) => (
          <>
            {data.allReconciled ? (
              <Alert>
                <AlertTitle>All accounts reconcile</AlertTitle>
                <AlertDescription>
                  Every recorded balance equals the signed sum of that account&apos;s postings.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Reconciliation failed</AlertTitle>
                <AlertDescription>
                  At least one account&apos;s recorded balance disagrees with its posting history.
                  The rows below show which, and by how much.
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Recorded</TableHead>
                  <TableHead className="text-right">Computed</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((entry) => (
                  <TableRow key={entry.accountId}>
                    <TableCell>
                      <Link
                        to="/accounts/$accountId"
                        params={{ accountId: entry.accountId }}
                        className="underline-offset-4 hover:underline"
                      >
                        {entry.accountName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.recordedBalance.amount} {entry.recordedBalance.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.computedBalance.amount} {entry.computedBalance.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {/*
                        The diagnosis, not just the alarm. When this is
                        non-zero an operator needs to know by how much, not
                        merely that something is wrong.
                      */}
                      {entry.reconciled ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-destructive">{formatDrift(entry)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.reconciled ? "muted" : "destructive"}>
                        {entry.reconciled ? "ok" : "drift"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </QueryState>
    </div>
  );
}
