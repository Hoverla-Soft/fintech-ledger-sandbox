import { parseAmount } from "@/lib/ledger/amount";

/**
 * Turning the summary aggregate into chartable series.
 *
 * Two rules shape everything here.
 *
 * **Missing days are zero, not absent.** The server returns a row only for days
 * that had activity. Plotting those rows directly would put an 8-day gap
 * shoulder-to-shoulder with a 1-day gap and read as continuous — a bar chart's
 * x-axis is a *timeline*, so every day in the window has to occupy its slot
 * whether or not anything happened on it.
 *
 * **Amounts stay `bigint` minor units** (`docs/adr/0002-money-representation.md`).
 * No `Number` or `parseFloat` touches a monetary value. The one place a `Number`
 * appears is `barHeightPercent`, and only *after* a `bigint` division has already
 * reduced the ratio to a small integer — that result is a pixel proportion, not
 * money, and cannot carry a rounding error back into an amount.
 */

export interface WireAmount {
  readonly amount: string;
  readonly currency: string;
}

export interface WireActivityPoint {
  readonly date: string;
  readonly currency: string;
  readonly transactionCount: number;
  readonly debitVolume: WireAmount;
}

export interface WireCurrencyPosition {
  readonly currency: string;
  readonly accountCount: number;
  readonly normalTotal: WireAmount;
  readonly externalTotal: WireAmount;
}

/** One slot on a daily axis. `value` is a count; `minorUnits` is money. */
export interface DailyPoint {
  /** `YYYY-MM-DD`, UTC. */
  readonly date: string;
  readonly count: number;
  readonly minorUnits: bigint;
}

/**
 * The UTC calendar days in the window, oldest first, ending on `today`.
 *
 * UTC deliberately: the server groups with `date_trunc('day', created_at)` on a
 * timestamp column, so building local-time day keys here would misalign every
 * bar for any user east or west of UTC — activity would appear on the wrong day
 * rather than merely being labelled oddly.
 */
export function windowDays(today: Date, days: number): string[] {
  const endUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;

  return Array.from({ length: Math.max(days, 0) }, (_unused, index) =>
    new Date(endUtc - (days - 1 - index) * dayMs).toISOString().slice(0, 10),
  );
}

/**
 * Collapses the per-currency activity rows into one point per day.
 *
 * Counts are summed across currencies because a count is dimensionless — three
 * USD transfers and two EUR transfers really are five transactions. `minorUnits`
 * is deliberately left at `0n` on this series: **amounts are not summable across
 * currencies**, and adding USD to EUR to make a taller bar would be the kind of
 * quietly meaningless number a dashboard should never show. Volume gets its own
 * per-currency series instead.
 */
export function dailyTransactionCounts(
  activity: readonly WireActivityPoint[],
  today: Date,
  days: number,
): DailyPoint[] {
  const countByDate = new Map<string, number>();
  for (const point of activity) {
    countByDate.set(point.date, (countByDate.get(point.date) ?? 0) + point.transactionCount);
  }

  return windowDays(today, days).map((date) => ({
    date,
    count: countByDate.get(date) ?? 0,
    minorUnits: 0n,
  }));
}

/**
 * Daily debit volume for one currency.
 *
 * Returns `null` if any of that currency's amounts will not parse. A chart that
 * silently dropped an unreadable day would understate what moved while looking
 * authoritative — the same reasoning `features/transactions/total.ts` records for
 * refusing to render a partial total.
 */
export function dailyVolume(
  activity: readonly WireActivityPoint[],
  currency: string,
  today: Date,
  days: number,
): DailyPoint[] | null {
  const minorUnitsByDate = new Map<string, bigint>();

  for (const point of activity) {
    if (point.currency !== currency) {
      continue;
    }
    const parsed = parseAmount(point.debitVolume.amount, point.debitVolume.currency);
    if (!parsed.ok) {
      return null;
    }
    minorUnitsByDate.set(point.date, (minorUnitsByDate.get(point.date) ?? 0n) + parsed.minorUnits);
  }

  return windowDays(today, days).map((date) => ({
    date,
    count: 0,
    minorUnits: minorUnitsByDate.get(date) ?? 0n,
  }));
}

/** Currencies that actually saw activity in the window, in first-seen order. */
export function activeCurrencies(activity: readonly WireActivityPoint[]): string[] {
  return [...new Set(activity.map((point) => point.currency))];
}

/**
 * A bar's height as a percentage of the tallest bar, `0`–`100`.
 *
 * The `bigint` division happens first and yields an integer in `0..1000`; only
 * that small integer becomes a `Number`. Doing it the other way round — casting
 * the amounts and dividing as floats — is exactly the ADR 0002 violation this
 * codebase exists to demonstrate the absence of.
 *
 * A zero or negative maximum yields `0`: there is nothing to be a proportion of,
 * and dividing would either throw or invent a scale.
 */
export function barHeightPercent(value: bigint, max: bigint): number {
  if (max <= 0n || value <= 0n) {
    return 0;
  }
  const capped = value > max ? max : value;
  return Number((capped * 1000n) / max) / 10;
}

/** The tallest value in a series, as `bigint` minor units. */
export function maxMinorUnits(points: readonly DailyPoint[]): bigint {
  return points.reduce(
    (largest, point) => (point.minorUnits > largest ? point.minorUnits : largest),
    0n,
  );
}

/** The largest count in a series. */
export function maxCount(points: readonly DailyPoint[]): number {
  return points.reduce((largest, point) => Math.max(largest, point.count), 0);
}

/**
 * Whether a currency's two sides mirror each other exactly.
 *
 * `normalTotal + externalTotal === 0` holds for any organization reachable
 * through the ledger's write path, because every transaction is balanced and
 * single-currency. Rendering it is the dashboard's health signal — and returning
 * `null` when a total will not parse keeps the screen from claiming "conserved"
 * on figures it could not read.
 */
export function isConserved(position: WireCurrencyPosition): boolean | null {
  const normal = parseAmount(position.normalTotal.amount, position.normalTotal.currency);
  const external = parseAmount(position.externalTotal.amount, position.externalTotal.currency);

  if (!normal.ok || !external.ok) {
    return null;
  }
  return normal.minorUnits + external.minorUnits === 0n;
}
