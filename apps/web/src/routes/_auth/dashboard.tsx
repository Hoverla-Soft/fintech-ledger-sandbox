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
import { DailyBarChart } from "@/features/dashboard/bar-chart";
import { StatTile } from "@/features/dashboard/stat-tile";
import {
  activeCurrencies,
  barHeightPercent,
  dailyTransactionCounts,
  dailyVolume,
  isConserved,
  maxCount,
  maxMinorUnits,
  type WireCurrencyPosition,
} from "@/features/dashboard/summary";
import { formatMinorUnits } from "@/lib/ledger/amount";
import { useOrgContext } from "@/lib/org/session";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardRoute,
});

/**
 * The console overview.
 *
 * Reads `dashboard.summary` — one call, all SQL aggregates. It used to count
 * `accounts.list`, which was a page length presented as a total; Phase 7a's
 * pagination turned that from harmless-in-a-small-sandbox into wrong, so the
 * count now comes from the server.
 *
 * ## Why volume gets one chart per currency
 *
 * Amounts in different currencies are not comparable magnitudes — 100 JPY beside
 * 100 USD on a shared axis invents a relationship the data does not contain. The
 * honest form is small multiples: one panel per currency, each scaled to its own
 * maximum. Counts *are* summable across currencies, so the activity chart is a
 * single series.
 *
 * Charts are capped at `MAX_VOLUME_PANELS` and the screen says so when it drops
 * any, rather than silently showing a subset.
 */

/** Small multiples stop being readable past a handful of panels. */
const MAX_VOLUME_PANELS = 3;

function DashboardRoute() {
  const { org, role } = useOrgContext();
  const summary = useQuery(orpc.dashboard.summary.queryOptions({ input: {} }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl">{org?.name ?? "Console"}</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as <span className="font-medium">{role}</span>.
          {role === "viewer" ? " You have read access to this organization." : null}
        </p>
      </div>

      <QueryState
        query={summary}
        loadingRows={4}
        empty={{
          isEmpty: (data) => data.totals.accountCount === 0,
          render: (
            <EmptyState
              title="Nothing to show yet"
              description="This organization has no accounts. Seed the sandbox to fill it with a working ledger, or create an account by hand."
              action={
                <Button variant="outline" render={<Link to="/sandbox" />}>
                  Open sandbox controls
                </Button>
              }
            />
          ),
        }}
      >
        {(data) => {
          // `new Date()` is read once per render rather than inside the pure
          // series builders, which take the boundary as an argument so they stay
          // deterministic and testable.
          const today = new Date();
          const counts = dailyTransactionCounts(data.activity, today, data.activityWindowDays);
          const busiestDay = maxCount(counts);
          const currencies = activeCurrencies(data.activity);
          const shownCurrencies = currencies.slice(0, MAX_VOLUME_PANELS);
          const droppedCurrencies = currencies.length - shownCurrencies.length;

          return (
            <div className="space-y-6">
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Accounts" value={String(data.totals.accountCount)} />
                <StatTile
                  label="Transactions"
                  value={String(data.totals.transactionCount)}
                  hint="Includes reversals"
                />
                <StatTile
                  label="Reversals"
                  value={String(data.totals.reversalCount)}
                  hint="Counted above too"
                />
                <StatTile
                  label="Refused"
                  value={String(data.totals.rejectionCount)}
                  hint="Posted nothing"
                />
              </section>

              <section className="space-y-3 rounded-none border p-4">
                <div>
                  <h2 className="font-medium">Held per currency</h2>
                  <p className="text-muted-foreground text-sm">
                    Every transaction is balanced and single-currency, so each currency&apos;s two
                    sides are exact mirrors. Their netting to zero is the point — money is neither
                    created nor destroyed here.
                  </p>
                </div>
                <CurrencyPositions positions={data.currencies} />
              </section>

              <section className="space-y-3 rounded-none border p-4">
                <div>
                  <h2 className="font-medium">Transactions per day</h2>
                  <p className="text-muted-foreground text-sm">
                    Last {data.activityWindowDays} days, all currencies. Counts are summable across
                    currencies; amounts are not, so they are charted separately below.
                  </p>
                </div>
                <DailyBarChart
                  title={`Transactions per day over the last ${data.activityWindowDays} days`}
                  points={counts}
                  heightOf={(point) => barHeightPercent(BigInt(point.count), BigInt(busiestDay))}
                  formatValue={(point) =>
                    `${point.count} ${point.count === 1 ? "transaction" : "transactions"}`
                  }
                  valueLabel="Transactions"
                  emptyMessage={`Nothing posted in the last ${data.activityWindowDays} days.`}
                />
              </section>

              {shownCurrencies.map((currency) => (
                <VolumePanel
                  key={currency}
                  currency={currency}
                  activity={data.activity}
                  today={today}
                  windowDays={data.activityWindowDays}
                />
              ))}

              {droppedCurrencies > 0 ? (
                <p className="text-muted-foreground text-xs">
                  {droppedCurrencies} further{" "}
                  {droppedCurrencies === 1 ? "currency is" : "currencies are"} not charted — small
                  multiples stop being readable past {MAX_VOLUME_PANELS}. Every currency is listed
                  in the table above.
                </p>
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

/**
 * Per-currency positions as a table, not a chart.
 *
 * Deliberate: a bar per currency on a shared axis would compare incomparable
 * units, and the numbers here are the point. The conservation column is the one
 * genuinely evaluative cell — it carries an icon-free word plus a badge variant,
 * never colour alone.
 */
function CurrencyPositions({ positions }: { positions: readonly WireCurrencyPosition[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Currency</TableHead>
          <TableHead className="text-right">Accounts</TableHead>
          <TableHead className="text-right">Held</TableHead>
          <TableHead className="text-right">External mirror</TableHead>
          <TableHead>Conserved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => {
          const conserved = isConserved(position);
          return (
            <TableRow key={position.currency}>
              <TableCell className="font-medium">{position.currency}</TableCell>
              <TableCell className="text-right tabular-nums">{position.accountCount}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {position.normalTotal.amount}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {position.externalTotal.amount}
              </TableCell>
              <TableCell>
                {/*
                  Three states, not two. `null` means an amount would not parse,
                  which is different from "not conserved" — claiming either
                  verdict on figures we could not read would be a guess.
                */}
                {conserved === null ? (
                  <Badge variant="secondary">unknown</Badge>
                ) : conserved ? (
                  <Badge variant="muted">yes</Badge>
                ) : (
                  <Badge variant="destructive">no</Badge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** One currency's daily debit volume, on its own scale. */
function VolumePanel({
  currency,
  activity,
  today,
  windowDays,
}: {
  currency: string;
  activity: Parameters<typeof dailyVolume>[0];
  today: Date;
  windowDays: number;
}) {
  const series = dailyVolume(activity, currency, today, windowDays);

  // `null` means an amount did not parse. A chart drawn from the days that did
  // parse would understate what moved while looking authoritative, so the panel
  // says what it cannot do instead.
  if (series === null) {
    return (
      <section className="space-y-2 rounded-none border p-4">
        <h2 className="font-medium">{currency} moved per day</h2>
        <p className="text-muted-foreground text-sm">
          One of this currency&apos;s daily totals could not be read, so the chart is not drawn
          rather than drawn incomplete.
        </p>
      </section>
    );
  }

  const largest = maxMinorUnits(series);

  return (
    <section className="space-y-3 rounded-none border p-4">
      <div>
        <h2 className="font-medium">{currency} moved per day</h2>
        <p className="text-muted-foreground text-sm">
          Sum of the debit legs each day. Peak: {formatMinorUnits(largest, currency)} {currency}.
        </p>
      </div>
      <DailyBarChart
        title={`${currency} moved per day over the last ${windowDays} days`}
        points={series}
        heightOf={(point) => barHeightPercent(point.minorUnits, largest)}
        formatValue={(point) => `${formatMinorUnits(point.minorUnits, currency)} ${currency}`}
        valueLabel={`Debit volume (${currency})`}
        emptyMessage={`No ${currency} moved in the last ${windowDays} days.`}
      />
    </section>
  );
}
