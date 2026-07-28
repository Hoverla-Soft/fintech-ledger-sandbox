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
import { useEffect, useState } from "react";

import { EmptyState, QueryState } from "@/components/states";
import {
  FIRST_PAGE,
  goToNext,
  goToPrevious,
  hasPrevious,
  type PageState,
  pageNumber,
  resetToFirstPage,
} from "@/features/transactions/pagination";
import { describeFailure } from "@/lib/ledger/errors";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transactions/")({
  component: TransactionsRoute,
});

/**
 * Well inside the API's `1..200` range, so the `400 {issues}` branch on
 * `limit` is unreachable from this screen.
 */
const PAGE_SIZE = 25;

function TransactionsRoute() {
  const [page, setPage] = useState<PageState>(FIRST_PAGE);
  const [cursorExpired, setCursorExpired] = useState(false);

  const transactions = useQuery(
    orpc.transactions.list.queryOptions({
      input: { limit: PAGE_SIZE, ...(page.cursor === null ? {} : { cursor: page.cursor }) },
    }),
  );

  /**
   * An expired or malformed cursor sends the user back to page one **with a
   * notice**.
   *
   * Rendering it as an empty list would tell someone their ledger is empty
   * when it is not — the single worst thing this screen could say. The whole
   * walk is discarded rather than one step, because a stale cursor means the
   * sequence it belongs to is stale too.
   */
  useEffect(() => {
    if (!transactions.isError) {
      return;
    }
    if (describeFailure(transactions.error).reason === "invalid_cursor") {
      setPage(resetToFirstPage());
      setCursorExpired(true);
    }
  }, [transactions.isError, transactions.error]);

  const nextCursor = transactions.data?.nextCursor ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Oldest first. History is append-only — a transaction is never edited or removed, only
          corrected by a reversal.
        </p>
      </div>

      {cursorExpired ? (
        <p role="status" className="rounded-none border p-3 text-sm">
          That page link expired, so this is the first page again.
        </p>
      ) : null}

      <QueryState
        query={transactions}
        loadingRows={6}
        empty={{
          isEmpty: (data) => data.transactions.length === 0 && !hasPrevious(page),
          render: (
            <EmptyState
              title="No transactions yet"
              description="Post a transfer and it will appear here."
              action={
                <Button variant="outline" render={<Link to="/transfer" />}>
                  New transfer
                </Button>
              }
            />
          ),
        }}
      >
        {(data) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Posted</TableHead>
                  <TableHead>Kind</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <Link
                        to="/transactions/$transactionId"
                        params={{ transactionId: transaction.id }}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {transaction.id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>{transaction.currency}</TableCell>
                    <TableCell>{new Date(transaction.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {transaction.reversesTransactionId ? (
                        <Badge variant="secondary">reversal</Badge>
                      ) : (
                        <Badge variant="muted">transfer</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/*
              Amounts are absent because `transactions.list` returns
              `transactionSchema`, which carries no postings. Fetching each
              row's detail would be up to 200 extra membership-checked requests
              per page against an endpoint shaped to avoid exactly that.
              Recorded as open question #2; detail is one click away.
            */}
            <p className="text-xs text-muted-foreground">
              Amounts are shown on a transaction&apos;s own page.
            </p>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Page {pageNumber(page)}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPrevious(page) || transactions.isFetching}
                  onClick={() => {
                    setCursorExpired(false);
                    setPage(goToPrevious(page));
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={nextCursor === null || transactions.isFetching}
                  onClick={() => {
                    setCursorExpired(false);
                    setPage(goToNext(page, nextCursor));
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
