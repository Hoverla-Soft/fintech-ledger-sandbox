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

import {
  CursorExpiredNotice,
  PageControls,
  useCursorRecovery,
  usePageState,
} from "@/components/paging";
import { EmptyState, QueryState } from "@/components/states";
import { formatDrift } from "@/features/reconciliation/drift";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/reconciliation")({
  component: ReconciliationRoute,
});

/** Well inside the API's `1..200` range, so the `400 {issues}` branch on `limit` is unreachable from this screen. */
const PAGE_SIZE = 25;

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
 *
 * The table pages; the **verdict does not**. `allReconciled`,
 * `unreconciledCount`, and `accountCount` are whole-org figures from a separate
 * aggregate, so the banner is true regardless of which page is on screen. If it
 * were folded from the visible rows, page one of a large org would show "all
 * accounts reconcile" while drift sat on page two — and someone would trust it.
 */
function ReconciliationRoute() {
  const paging = usePageState();
  const reconciliation = useQuery(
    orpc.reconciliation.verify.queryOptions({
      input: { limit: PAGE_SIZE, ...paging.cursorInput },
    }),
  );
  useCursorRecovery(paging, reconciliation);

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

      <CursorExpiredNotice show={paging.cursorExpired} />

      <QueryState
        query={reconciliation}
        loadingRows={5}
        empty={{
          // `accountCount` rather than the page length: an org with accounts but
          // an empty later page has nothing to say "no accounts" about.
          isEmpty: (data) => data.accountCount === 0 && !hasPrevious(paging.page),
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
            {/*
              The banner speaks for the whole organization, the table for one
              page. Saying which is which matters most in the failure case: a
              reader looking at a clean page under a red banner needs to know the
              drift is real and simply elsewhere, not that the screen is confused.
            */}
            {data.allReconciled ? (
              <Alert>
                <AlertTitle>
                  All {data.accountCount} {data.accountCount === 1 ? "account" : "accounts"}{" "}
                  reconcile
                </AlertTitle>
                <AlertDescription>
                  Every recorded balance in this organization equals the signed sum of that
                  account&apos;s postings — checked across every account, not just the page below.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>
                  Reconciliation failed — {data.unreconciledCount} of {data.accountCount}{" "}
                  {data.accountCount === 1 ? "account" : "accounts"} disagree
                </AlertTitle>
                <AlertDescription>
                  At least one recorded balance disagrees with its posting history. Rows marked
                  &quot;drift&quot; below show which and by how much; if this page shows none, the
                  affected accounts are on another page.
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

            <PageControls
              paging={paging}
              nextCursor={data.nextCursor}
              isFetching={reconciliation.isFetching}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
