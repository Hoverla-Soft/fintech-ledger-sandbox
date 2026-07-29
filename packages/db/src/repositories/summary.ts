import { and, eq, gte, sql } from "drizzle-orm";

import type { Db } from "../index";
import {
  ledgerAccount,
  ledgerAuditEntry,
  ledgerPosting,
  ledgerTransaction,
} from "../schema/ledger";

/**
 * Whole-org aggregates for the overview screen.
 *
 * Every function here is a `GROUP BY` or a `count`, never a row list. That is
 * the whole reason this module exists: Phase 7a made every list read a *page*,
 * so "how many accounts does this org have" and "how much is held in EUR" no
 * longer have honest client-side answers. A dashboard that counted a page would
 * be quietly wrong the moment an org outgrew it.
 *
 * Amounts stay `bigint` minor units here and become decimal strings at the wire
 * boundary (ADR 0002). Counts are `number`: they are counts for display, not
 * money, and an org cannot hold enough rows for `Number` to lose precision.
 */

/** How much sits in one currency, split by the two account types that mirror each other. */
export interface CurrencyPosition {
  readonly currency: string;
  readonly accountCount: number;
  /** Signed sum of `normal` account balances — what the org's participants hold. */
  readonly normalTotal: bigint;
  /**
   * Signed sum of `external` account balances — the outside world's mirror
   * image.
   *
   * `normalTotal + externalTotal` is necessarily `0n` for any org reachable
   * through the ledger's write path: every transaction is balanced and
   * single-currency, so summing balances across *all* accounts in a currency
   * sums every signed posting in that currency, which is a sum of zeroes.
   * Returning both sides rather than a single "total balance" is deliberate — a
   * total balance would always read `0.00` and look broken, while these two
   * mirroring each other is the actual health signal.
   */
  readonly externalTotal: bigint;
}

/** One day's activity in one currency. */
export interface ActivityPoint {
  /** `YYYY-MM-DD`, UTC. */
  readonly date: string;
  readonly currency: string;
  readonly transactionCount: number;
  /**
   * Sum of the **debit** legs of that day's transactions.
   *
   * Debits only, because a balanced transaction's debits and credits are equal
   * and opposite — summing both would always yield zero, and summing all legs
   * regardless of direction would double-count what moved.
   */
  readonly debitVolume: bigint;
}

export interface OrgTotals {
  readonly accountCount: number;
  readonly transactionCount: number;
  /** Transactions that reverse another. A reversal is still a transaction, so this is a subset of `transactionCount`. */
  readonly reversalCount: number;
  readonly rejectionCount: number;
}

export interface OrgSummary {
  readonly currencies: readonly CurrencyPosition[];
  readonly activity: readonly ActivityPoint[];
  readonly totals: OrgTotals;
}

/** Days of activity the series covers, counting back from today. */
export const ACTIVITY_WINDOW_DAYS = 30;

/** `pg` returns `count(*)` and `sum(bigint)` as strings — both are `bigint` in Postgres. */
function toCount(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function toMinorUnits(value: string | null): bigint {
  return value === null ? 0n : BigInt(value);
}

async function loadCurrencyPositions(db: Db, orgId: string): Promise<CurrencyPosition[]> {
  const rows = await db
    .select({
      currency: ledgerAccount.currency,
      accountCount: sql<string>`count(*)`,
      normalTotal: sql<
        string | null
      >`sum(case when ${ledgerAccount.type} = 'normal' then ${ledgerAccount.balance} else 0 end)`,
      externalTotal: sql<
        string | null
      >`sum(case when ${ledgerAccount.type} = 'external' then ${ledgerAccount.balance} else 0 end)`,
    })
    .from(ledgerAccount)
    .where(eq(ledgerAccount.orgId, orgId))
    .groupBy(ledgerAccount.currency)
    .orderBy(ledgerAccount.currency);

  return rows.map((row) => ({
    currency: row.currency,
    accountCount: toCount(row.accountCount),
    normalTotal: toMinorUnits(row.normalTotal),
    externalTotal: toMinorUnits(row.externalTotal),
  }));
}

/**
 * Daily transaction counts and debit volume, grouped by day and currency.
 *
 * `count(distinct ...)` on the transaction id is load-bearing. Joining postings
 * multiplies each transaction row by its leg count, so a plain `count(*)` would
 * report a 4-leg payroll run as four transactions — and the same multiplication
 * is exactly what makes `sum` over debit legs correct, since each leg must be
 * counted once. The two aggregates want opposite things from the same join, and
 * `distinct` is what reconciles them.
 */
async function loadActivity(db: Db, orgId: string, since: Date): Promise<ActivityPoint[]> {
  const day = sql<string>`to_char(date_trunc('day', ${ledgerTransaction.createdAt}), 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: day,
      currency: ledgerTransaction.currency,
      transactionCount: sql<string>`count(distinct ${ledgerTransaction.id})`,
      debitVolume: sql<
        string | null
      >`sum(case when ${ledgerPosting.direction} = 'debit' then ${ledgerPosting.amount} else 0 end)`,
    })
    .from(ledgerTransaction)
    // An INNER JOIN is correct here, unlike in `reconciliation.ts`: a
    // transaction with no postings cannot exist (`Transaction.create` requires
    // at least two legs), so there is no posting-less row to preserve.
    .innerJoin(
      ledgerPosting,
      and(
        eq(ledgerPosting.transactionId, ledgerTransaction.id),
        eq(ledgerPosting.orgId, ledgerTransaction.orgId),
      ),
    )
    .where(and(eq(ledgerTransaction.orgId, orgId), gte(ledgerTransaction.createdAt, since)))
    .groupBy(day, ledgerTransaction.currency)
    .orderBy(day, ledgerTransaction.currency);

  return rows.map((row) => ({
    date: row.date,
    currency: row.currency,
    transactionCount: toCount(row.transactionCount),
    debitVolume: toMinorUnits(row.debitVolume),
  }));
}

async function loadTotals(db: Db, orgId: string): Promise<OrgTotals> {
  const [accounts, transactions, rejections] = await Promise.all([
    db
      .select({ count: sql<string>`count(*)` })
      .from(ledgerAccount)
      .where(eq(ledgerAccount.orgId, orgId)),
    db
      .select({
        count: sql<string>`count(*)`,
        reversals: sql<string>`count(*) filter (where ${ledgerTransaction.reversesTransactionId} is not null)`,
      })
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.orgId, orgId)),
    db
      .select({ count: sql<string>`count(*)` })
      .from(ledgerAuditEntry)
      .where(and(eq(ledgerAuditEntry.orgId, orgId), eq(ledgerAuditEntry.outcome, "rejected"))),
  ]);

  return {
    accountCount: toCount(accounts[0]?.count ?? null),
    transactionCount: toCount(transactions[0]?.count ?? null),
    reversalCount: toCount(transactions[0]?.reversals ?? null),
    rejectionCount: toCount(rejections[0]?.count ?? null),
  };
}

/**
 * Everything the overview screen needs, in a fixed number of queries.
 *
 * Fixed is the property worth defending: the count does not grow with accounts,
 * transactions, or currencies, so this endpoint cannot become the reason a busy
 * org's dashboard is slow. Pinned by a test that wraps `pool.query`.
 *
 * `since` is passed in rather than computed here so the caller owns the clock —
 * which keeps this function deterministic and testable without freezing time.
 */
export async function summarizeOrg(db: Db, orgId: string, since: Date): Promise<OrgSummary> {
  const [currencies, activity, totals] = await Promise.all([
    loadCurrencyPositions(db, orgId),
    loadActivity(db, orgId, since),
    loadTotals(db, orgId),
  ]);

  return { currencies, activity, totals };
}
