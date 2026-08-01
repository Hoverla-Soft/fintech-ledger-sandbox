import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Separator } from "@fintech-ledger-sandbox/ui/components/separator";
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
import { QueryState } from "@/components/states";
import {
  AccountBalance,
  AccountStatusBadge,
  AccountTypeBadge,
  isSuspenseAccount,
} from "@/features/accounts/account-display";
import { runningBalanceSeries } from "@/features/accounts/statement-sparkline";
import { DailyBarChart } from "@/features/dashboard/bar-chart";
import { barHeightPercent, maxMinorUnits } from "@/features/dashboard/summary";
import { formatMinorUnits } from "@/lib/ledger/amount";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/accounts/$accountId")({
  component: AccountDetailRoute,
});

const PAGE_SIZE = 25;

/**
 * One account as a statement: header facts plus posting timeline with running
 * balance. A `404` here means the id is missing or belongs to another org —
 * the API collapses both deliberately.
 */
function AccountDetailRoute() {
  const { accountId } = Route.useParams();
  const account = useQuery(orpc.accounts.get.queryOptions({ input: { accountId } }));
  const paging = usePageState();
  const postings = useQuery(
    orpc.accounts.postings.queryOptions({
      input: { accountId, limit: PAGE_SIZE, ...paging.cursorInput },
    }),
  );
  useCursorRecovery(paging, postings);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button variant="outline" size="sm" render={<Link to="/accounts" />}>
        ← All accounts
      </Button>

      <QueryState query={account} loadingRows={4}>
        {(data) => (
          <div className="space-y-4 rounded-none border p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{data.name}</h1>
                {isSuspenseAccount(data) ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Opened automatically by a sandbox reset to hold a partially unwound balance.
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <AccountTypeBadge type={data.type} />
                <AccountStatusBadge active={data.active} />
              </div>
            </div>

            <Separator />

            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Balance</dt>
                <dd>
                  <AccountBalance account={data} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Currency</dt>
                <dd>{data.currency}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(data.createdAt).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-8">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono text-xs break-all">{data.id}</dd>
              </div>
            </dl>

            {data.type === "external" ? (
              <p className="text-sm text-muted-foreground">
                External accounts represent value entering or leaving the sandbox, so a negative
                balance here is expected rather than an error.
              </p>
            ) : null}

            <Separator />

            <div className="space-y-3">
              <div>
                <h2 className="font-medium">Statement</h2>
                <p className="text-sm text-muted-foreground">
                  Oldest first. Running balance is the signed sum of postings after each leg.
                </p>
              </div>

              <CursorExpiredNotice show={paging.cursorExpired} />

              <QueryState
                query={postings}
                loadingRows={5}
                empty={{
                  isEmpty: (page) => page.postings.length === 0 && !hasPrevious(paging.page),
                  render: (
                    <p className="rounded-none border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No postings on this account yet.
                    </p>
                  ),
                }}
              >
                {(page) => {
                  const series = runningBalanceSeries(page.postings);
                  const max = series ? maxMinorUnits(series) : 0n;
                  return (
                    <>
                      {series && series.length > 0 ? (
                        <DailyBarChart
                          title="Running balance (absolute, by day)"
                          points={series}
                          heightOf={(point) => barHeightPercent(point.minorUnits, max)}
                          formatValue={(point) =>
                            `${formatMinorUnits(point.minorUnits, data.currency)} ${data.currency} (abs)`
                          }
                          valueLabel="|balance|"
                          emptyMessage="No balance history to chart on this page."
                        />
                      ) : null}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Direction</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Running</TableHead>
                            <TableHead>Txn</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {page.postings.map((posting) => (
                            <TableRow key={posting.id}>
                              <TableCell className="whitespace-nowrap text-xs">
                                {new Date(posting.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={posting.direction === "debit" ? "outline" : "secondary"}
                                >
                                  {posting.direction}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {posting.amount.amount} {posting.amount.currency}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {posting.runningBalance.amount}
                              </TableCell>
                              <TableCell>
                                <Link
                                  to="/transactions/$transactionId"
                                  params={{ transactionId: posting.transactionId }}
                                  search={{ play: true }}
                                  className="font-mono text-xs underline-offset-4 hover:underline"
                                >
                                  {posting.transactionId.slice(0, 8)}…
                                </Link>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <PageControls
                        paging={paging}
                        nextCursor={page.nextCursor}
                        isFetching={postings.isFetching}
                      />
                    </>
                  );
                }}
              </QueryState>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
