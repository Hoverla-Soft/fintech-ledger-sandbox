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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/transactions/")({
  component: TransactionsRoute,
});

const PAGE_SIZE = 25;
/** Hard stop so a dense org cannot freeze the tab walking forever. */
const EXPORT_MAX_PAGES = 50;

type KindFilter = "all" | "reversals" | "transfers";

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
  const [kind, setKind] = useState<KindFilter>("all");
  const [currency, setCurrency] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");
  const [createdAfter, setCreatedAfter] = useState("");
  const [createdBefore, setCreatedBefore] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [exporting, setExporting] = useState(false);

  const listFilters = useMemo(() => {
    return {
      ...(kind !== "all" ? { kind } : {}),
      ...(currency !== "all" ? { currency } : {}),
      ...(accountId !== "all" ? { accountId } : {}),
      ...(createdAfter.trim() ? { createdAfter: new Date(createdAfter).toISOString() } : {}),
      ...(createdBefore.trim() ? { createdBefore: new Date(createdBefore).toISOString() } : {}),
      ...(minAmount.trim() ? { minAmount: minAmount.trim() } : {}),
      ...(maxAmount.trim() ? { maxAmount: maxAmount.trim() } : {}),
    };
  }, [kind, currency, accountId, createdAfter, createdBefore, minAmount, maxAmount]);

  // Filter changes invalidate the cursor walk — start over without the
  // "expired cursor" chrome (that message is for a rejected token only).
  useEffect(() => {
    paging.reset();
  }, [listFilters, paging.reset]);

  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { limit: 100 } }));

  const transactions = useQuery(
    orpc.transactions.list.queryOptions({
      input: { limit: PAGE_SIZE, ...paging.cursorInput, ...listFilters },
    }),
  );
  useCursorRecovery(paging, transactions);

  const nextCursor = transactions.data?.nextCursor ?? null;
  const rows = transactions.data?.transactions ?? [];

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const account of accounts.data?.accounts ?? []) {
      set.add(account.currency);
    }
    for (const txn of rows) {
      set.add(txn.currency);
    }
    return [...set].sort();
  }, [accounts.data, rows]);

  async function exportFiltered() {
    if (exporting) {
      return;
    }
    setExporting(true);
    try {
      const collected: string[][] = [];
      let cursor: string | undefined;
      for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
        const result = await client.transactions.list({
          limit: PAGE_SIZE,
          ...listFilters,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        for (const txn of result.transactions) {
          collected.push([
            txn.id,
            txn.currency,
            formatTransactionTotal(txn.postings) ?? "",
            txn.createdAt,
            txn.reversesTransactionId ? "reversal" : "transfer",
          ]);
        }
        if (result.nextCursor === null) {
          break;
        }
        cursor = result.nextCursor;
        if (page === EXPORT_MAX_PAGES - 1) {
          toast.message("Export capped", {
            description: `Downloaded the first ${EXPORT_MAX_PAGES * PAGE_SIZE} matching rows.`,
          });
        }
      }
      if (collected.length === 0) {
        toast.message("Nothing to export");
        return;
      }
      downloadCsv("transactions.csv", ["id", "currency", "amount", "createdAt", "kind"], collected);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
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
          disabled={exporting || (rows.length === 0 && !hasPrevious(paging.page))}
          onClick={() => void exportFiltered()}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="txn-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind((v as KindFilter) ?? "all")}>
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
          <Label htmlFor="txn-account">Account</Label>
          <Select value={accountId} onValueChange={(v) => setAccountId(v ?? "all")}>
            <SelectTrigger id="txn-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {(accounts.data?.accounts ?? []).map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-after">From</Label>
          <Input
            id="txn-after"
            type="datetime-local"
            value={createdAfter}
            onChange={(e) => setCreatedAfter(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-before">To</Label>
          <Input
            id="txn-before"
            type="datetime-local"
            value={createdBefore}
            onChange={(e) => setCreatedBefore(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-min">Min amount</Label>
          <Input
            id="txn-min"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Debit total ≥"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-max">Max amount</Label>
          <Input
            id="txn-max"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Debit total ≤"
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Filters run on the server across the whole history. Export walks matching pages (cap{" "}
        {EXPORT_MAX_PAGES * PAGE_SIZE} rows). Amount bounds compare each transaction&apos;s debit
        total in that transaction&apos;s currency.
      </p>

      <CursorExpiredNotice show={paging.cursorExpired} />

      <QueryState
        query={transactions}
        loadingRows={6}
        empty={{
          isEmpty: (data) => data.transactions.length === 0 && !hasPrevious(paging.page),
          render: (
            <EmptyState
              title="No matching transactions"
              description="Widen the filters or post a transfer."
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
                {rows.map((transaction) => (
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
