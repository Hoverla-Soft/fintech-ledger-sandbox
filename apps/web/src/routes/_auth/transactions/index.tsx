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
import { formatTransactionTotal, type WirePosting } from "@/features/transactions/total";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transactions/")({
  component: TransactionsRoute,
});

/**
 * Well inside the API's `1..200` range, so the `400 {issues}` branch on
 * `limit` is unreachable from this screen.
 */
const PAGE_SIZE = 25;

/**
 * The total a transaction moved, or an explicit dash when it cannot be
 * computed.
 *
 * The dash matters: rendering `0.00` for a transaction whose legs would not
 * parse would claim nothing moved, which is a different and false statement.
 * On a ledger the difference between "nothing" and "we cannot say" is the
 * whole point.
 */
function TransactionTotal({ postings }: { postings: readonly WirePosting[] }) {
  const total = formatTransactionTotal(postings);
  if (total === null) {
    return (
      <span className="text-muted-foreground" title="This transaction's legs could not be totalled">
        —
      </span>
    );
  }
  return <>{total}</>;
}

function TransactionsRoute() {
  const paging = usePageState();
  const transactions = useQuery(
    orpc.transactions.list.queryOptions({ input: { limit: PAGE_SIZE, ...paging.cursorInput } }),
  );
  useCursorRecovery(paging, transactions);

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

      <CursorExpiredNotice show={paging.cursorExpired} />

      <QueryState
        query={transactions}
        loadingRows={6}
        empty={{
          isEmpty: (data) => data.transactions.length === 0 && !hasPrevious(paging.page),
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
                  <TableHead className="text-right">Amount</TableHead>
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
                    <TableCell className="text-right font-mono tabular-nums">
                      <TransactionTotal postings={transaction.postings} />
                    </TableCell>
                    <TableCell>{transaction.currency}</TableCell>
                    <TableCell>{new Date(transaction.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="space-x-1">
                      {transaction.reversesTransactionId ? (
                        <Badge variant="secondary">reversal</Badge>
                      ) : (
                        <Badge variant="muted">transfer</Badge>
                      )}
                      {transaction.reversedBy.length > 0 ? (
                        <Badge variant="destructive">
                          {transaction.reversedBy.length === 1
                            ? "reversed"
                            : `reversed ×${transaction.reversedBy.length}`}
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <PageControls
              paging={paging}
              nextCursor={nextCursor}
              isFetching={transactions.isFetching}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
