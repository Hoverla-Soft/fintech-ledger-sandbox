import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Separator } from "@fintech-ledger-sandbox/ui/components/separator";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { QueryState } from "@/components/states";
import { PostingsTable } from "@/features/transactions/postings-table";
import { ReverseDialog } from "@/features/transactions/reverse-dialog";
import { useOrgContext } from "@/lib/org/session";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transactions/$transactionId")({
  component: TransactionDetailRoute,
});

/** One transaction and its legs. */
function TransactionDetailRoute() {
  const { transactionId } = Route.useParams();
  const transaction = useQuery(orpc.transactions.get.queryOptions({ input: { transactionId } }));
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { limit: 200 } }));
  const { canWrite } = useOrgContext();

  const accountNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const account of accounts.data?.accounts ?? []) {
      names.set(account.id, account.name);
    }
    return names;
  }, [accounts.data]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button variant="outline" size="sm" render={<Link to="/transactions" />}>
        ← All transactions
      </Button>

      <QueryState query={transaction} loadingRows={4}>
        {(data) => (
          <div className="space-y-4 rounded-none border p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold">Transaction</h1>
                <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{data.id}</p>
              </div>
              <div className="flex items-center gap-2">
                {data.reversesTransactionId ? <Badge variant="secondary">reversal</Badge> : null}
                {data.reversedBy.length > 0 ? (
                  <Badge variant="destructive">
                    {data.reversedBy.length === 1
                      ? "reversed"
                      : `reversed ×${data.reversedBy.length}`}
                  </Badge>
                ) : null}
                {canWrite ? (
                  <ReverseDialog
                    transactionId={data.id}
                    reversedBy={data.reversedBy}
                    partOfExchange={
                      data.fxSourceTransactionId !== null || data.fxTargetTransactionId !== null
                    }
                    onReversed={() => {
                      void transaction.refetch();
                    }}
                  />
                ) : null}
              </div>
            </div>

            {data.fxTargetTransactionId ? (
              <p className="text-sm text-muted-foreground">
                This is the outgoing half of a currency exchange. The money continues into{" "}
                <Link
                  to="/transactions/$transactionId"
                  params={{ transactionId: data.fxTargetTransactionId }}
                  className="underline underline-offset-4"
                >
                  the converted transaction
                </Link>
                , which was posted in the same commit — both halves exist or neither does.
              </p>
            ) : null}

            {data.fxSourceTransactionId ? (
              <p className="text-sm text-muted-foreground">
                This is the incoming half of a currency exchange
                {data.fxRate ? `, converted at a rate of ${data.fxRate}` : ""}. It came from{" "}
                <Link
                  to="/transactions/$transactionId"
                  params={{ transactionId: data.fxSourceTransactionId }}
                  className="underline underline-offset-4"
                >
                  the outgoing transaction
                </Link>
                .
              </p>
            ) : null}

            {data.reversesTransactionId ? (
              <p className="text-sm text-muted-foreground">
                This transaction reverses{" "}
                <Link
                  to="/transactions/$transactionId"
                  params={{ transactionId: data.reversesTransactionId }}
                  className="underline underline-offset-4"
                >
                  an earlier transaction
                </Link>
                . The original is unchanged — history is append-only, so a correction is always a
                new entry.
              </p>
            ) : null}

            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Currency</dt>
                <dd>{data.currency}</dd>
              </div>
              <div className="flex justify-between gap-8">
                <dt className="text-muted-foreground">Posted by</dt>
                <dd className="font-mono text-xs break-all">{data.createdBy}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Posted</dt>
                <dd>{new Date(data.createdAt).toLocaleString()}</dd>
              </div>
            </dl>

            <Separator />

            <div>
              <h2 className="mb-2 font-medium">Journal</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Oldest first. Every transaction is a balanced set of at least two legs — money is
                never created or destroyed, only moved.
              </p>
              <PostingsTable postings={data.postings} accountNames={accountNames} />
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
