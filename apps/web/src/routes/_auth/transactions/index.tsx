import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import { Label } from "@fintech-ledger-sandbox/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@fintech-ledger-sandbox/ui/components/select";
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
import { useMemo, useState } from "react";

import {
  CursorExpiredNotice,
  PageControls,
  useCursorRecovery,
  usePageState,
} from "@/components/paging";
import { EmptyState, QueryState } from "@/components/states";
import { formatTransactionTotal, type WirePosting } from "@/features/transactions/total";
import { downloadCsv } from "@/lib/export/csv";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transactions/")({
  component: TransactionsRoute,
});

const PAGE_SIZE = 25;

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
  const [kind, setKind] = useState<"all" | "reversals" | "transfers">("all");
  const [currency, setCurrency] = useState<string>("all");
  const [query, setQuery] = useState("");

  const transactions = useQuery(
    orpc.transactions.list.queryOptions({ input: { limit: PAGE_SIZE, ...paging.cursorInput } }),
  );
  useCursorRecovery(paging, transactions);

  const nextCursor = transactions.data?.nextCursor ?? null;

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const txn of transactions.data?.transactions ?? []) {
      set.add(txn.currency);
    }
    return [...set].sort();
  }, [transactions.data]);

  const filtered = useMemo(() => {
    const rows = transactions.data?.transactions ?? [];
    return rows.filter((txn) => {
      if (kind === "reversals" && !txn.reversesTransactionId) {
        return false;
      }
      if (kind === "transfers" && txn.reversesTransactionId) {
        return false;
      }
      if (currency !== "all" && txn.currency !== currency) {
        return false;
      }
      if (query.trim().length > 0 && !txn.id.toLowerCase().includes(query.trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [transactions.data, kind, currency, query]);

  function exportPage() {
    downloadCsv(
      "transactions.csv",
      ["id", "currency", "amount", "createdAt", "kind"],
      filtered.map((txn) => [
        txn.id,
        txn.currency,
        formatTransactionTotal(txn.postings) ?? "",
        txn.createdAt,
        txn.reversesTransactionId ? "reversal" : "transfer",
      ]),
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Oldest first. History is append-only — a transaction is never edited or removed, only
            corrected by a reversal.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filtered.length === 0}
          onClick={exportPage}
        >
          Export CSV
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="txn-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind((v as typeof kind) ?? "all")}>
            <SelectTrigger id="txn-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="transfers">Transfers</SelectItem>
              <SelectItem value="reversals">Reversals</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-currency">Currency</Label>
          <Select value={currency} onValueChange={(v) => setCurrency(v ?? "all")}>
            <SelectTrigger id="txn-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {currencies.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-query">Search id</Label>
          <Input
            id="txn-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Transaction id…"
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Filters apply to the current page. Export downloads the filtered rows visible here.
      </p>

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
        {() => (
          <>
            {filtered.length === 0 ? (
              <p className="rounded-none border border-dashed p-6 text-center text-sm text-muted-foreground">
                No transactions on this page match the filters.
              </p>
            ) : (
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
                  {filtered.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>
                        <Link
                          to="/transactions/$transactionId"
                          params={{ transactionId: transaction.id }}
                          search={{ play: true }}
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
            )}

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
