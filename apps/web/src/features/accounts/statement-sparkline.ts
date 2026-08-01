import type { DailyPoint } from "@/features/dashboard/summary";
import { parseAmount } from "@/lib/ledger/amount";

export interface StatementPostingPoint {
  readonly createdAt: string;
  readonly runningBalance: { readonly amount: string; readonly currency: string };
}

/**
 * Collapse statement postings into one sparkline point per UTC day.
 * Height uses absolute running balance so negative external balances still plot.
 */
export function runningBalanceSeries(
  postings: readonly StatementPostingPoint[],
): DailyPoint[] | null {
  const byDay = new Map<string, bigint>();

  for (const posting of postings) {
    const day = posting.createdAt.slice(0, 10);
    const parsed = parseAmount(posting.runningBalance.amount, posting.runningBalance.currency);
    if (!parsed.ok) {
      return null;
    }
    const abs = parsed.minorUnits < 0n ? -parsed.minorUnits : parsed.minorUnits;
    byDay.set(day, abs);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minorUnits]) => ({ date, count: 0, minorUnits }));
}
