import type { Money } from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, or, type SQL, sql } from "drizzle-orm";

import type { Db } from "../index";
import { toMoney } from "../internal/money";
import { ledgerAccount, ledgerPosting } from "../schema/ledger";
import {
  clampPageSize,
  type NameCursor,
  type Page,
  type PageRequest,
  splitPage,
} from "./pagination";

const DEFAULT_PAGE_SIZE = 50;

export interface AccountReconciliation {
  readonly accountId: string;
  readonly accountName: string;
  /** The materialized `ledger_account.balance`. */
  readonly recordedBalance: Money;
  /** `signed Σ(postings)` for this account, computed fresh from `ledger_posting`. */
  readonly computedBalance: Money;
  readonly reconciled: boolean;
}

/**
 * The whole-org verdict, independent of any page.
 *
 * This exists because `allReconciled` cannot be a fold over the rows a caller
 * happens to have fetched. A page-local verdict would report a clean ledger
 * while drift sat on page two — the single most dangerous thing a
 * reconciliation check can say. ADR 0003 makes reconciliation an invariant a
 * caller may assert at any time; an assertion that only covers a page is not
 * an assertion.
 */
export interface ReconciliationTotals {
  readonly accountCount: number;
  readonly unreconciledCount: number;
}

/**
 * `signed Σ(postings)` — debit positive, credit negative.
 *
 * The sign convention mirrors `core`'s `signedAmount`;
 * `packages/core/src/transaction/posting.ts` documents that this package
 * depends on that convention holding, and this expression is that dependency.
 */
function signedPostingSum() {
  return sql<
    string | null
  >`sum(case when ${ledgerPosting.direction} = 'debit' then ${ledgerPosting.amount} else -${ledgerPosting.amount} end)`;
}

/**
 * A `LEFT JOIN` keeps a freshly created, posting-less account in the result set
 * (its sum is `NULL`, treated as zero) instead of silently dropping it, which
 * an `INNER JOIN` would do — and a dropped account is an account whose drift
 * nobody checks.
 */
function joinPostings(orgId: string, extraFilter?: SQL) {
  const scope = eq(ledgerAccount.orgId, orgId);
  return {
    join: and(
      eq(ledgerPosting.accountId, ledgerAccount.id),
      eq(ledgerPosting.orgId, ledgerAccount.orgId),
    ),
    where: extraFilter ? and(scope, extraFilter) : scope,
  };
}

function toReconciliation(row: {
  accountId: string;
  accountName: string;
  currency: string;
  recordedBalance: bigint;
  computedBalance: string | null;
}): AccountReconciliation {
  const computedMinorUnits = row.computedBalance === null ? 0n : BigInt(row.computedBalance);
  const recordedBalance = toMoney(
    row.recordedBalance,
    row.currency,
    `ledger_account "${row.accountId}"`,
  );
  const computedBalance = toMoney(
    computedMinorUnits,
    row.currency,
    `ledger_account "${row.accountId}" posting sum`,
  );

  return {
    accountId: row.accountId,
    accountName: row.accountName,
    recordedBalance,
    computedBalance,
    reconciled: recordedBalance.equals(computedBalance),
  };
}

/**
 * Invariant #2 (`signed Σ(postings) == account.balance`) for **every** account
 * in `orgId`, unbounded.
 *
 * Aggregates in SQL rather than loading every posting into memory. Kept
 * unbounded, and not exposed on the wire: this is the form the integration
 * suites assert invariant #2 with, where checking a subset would defeat the
 * point. Wire reads use `pageReconciliation` plus `countReconciliation`.
 */
export async function reconcileAccounts(
  db: Db,
  orgId: string,
): Promise<readonly AccountReconciliation[]> {
  const { join, where } = joinPostings(orgId);

  const rows = await db
    .select({
      accountId: ledgerAccount.id,
      accountName: ledgerAccount.name,
      currency: ledgerAccount.currency,
      recordedBalance: ledgerAccount.balance,
      computedBalance: signedPostingSum().as("computed_balance"),
    })
    .from(ledgerAccount)
    .leftJoin(ledgerPosting, join)
    .where(where)
    .groupBy(ledgerAccount.id, ledgerAccount.name, ledgerAccount.currency, ledgerAccount.balance);

  return rows.map(toReconciliation);
}

/** One page of the same check, ordered by `(name, id)` to match `pageAccounts`. */
export async function pageReconciliation(
  db: Db,
  orgId: string,
  request: PageRequest<NameCursor> = {},
): Promise<Page<AccountReconciliation, NameCursor>> {
  const limit = clampPageSize(request.limit, DEFAULT_PAGE_SIZE);
  const after = request.after;

  const cursorFilter = after
    ? or(
        gt(ledgerAccount.name, after.name),
        and(eq(ledgerAccount.name, after.name), gt(ledgerAccount.id, after.id)),
      )
    : undefined;

  const { join, where } = joinPostings(orgId, cursorFilter);

  const rows = await db
    .select({
      accountId: ledgerAccount.id,
      accountName: ledgerAccount.name,
      currency: ledgerAccount.currency,
      recordedBalance: ledgerAccount.balance,
      computedBalance: signedPostingSum().as("computed_balance"),
    })
    .from(ledgerAccount)
    .leftJoin(ledgerPosting, join)
    .where(where)
    .groupBy(ledgerAccount.id, ledgerAccount.name, ledgerAccount.currency, ledgerAccount.balance)
    .orderBy(asc(ledgerAccount.name), asc(ledgerAccount.id))
    .limit(limit + 1);

  const { pageRows, hasMore, lastRow } = splitPage(rows, limit);

  return {
    items: pageRows.map(toReconciliation),
    nextCursor:
      hasMore && lastRow !== undefined
        ? { name: lastRow.accountName, id: lastRow.accountId }
        : null,
  };
}

/**
 * How many accounts the org has, and how many of them drift — over the whole
 * org, in one query, regardless of what page the caller is looking at.
 *
 * The comparison is done in SQL rather than by counting `reconciled === false`
 * over fetched rows, because the point is to cover accounts that were *not*
 * fetched. `coalesce(computed, 0)` is what makes a posting-less account count
 * as reconciled at zero instead of comparing `NULL <> 0`, which is `NULL` —
 * neither true nor false, and therefore not counted by `filter`, silently
 * excusing exactly the accounts most likely to be wrong.
 */
export async function countReconciliation(db: Db, orgId: string): Promise<ReconciliationTotals> {
  const { join, where } = joinPostings(orgId);

  const perAccount = db
    .select({
      recordedBalance: ledgerAccount.balance,
      computedBalance: signedPostingSum().as("computed_balance"),
    })
    .from(ledgerAccount)
    .leftJoin(ledgerPosting, join)
    .where(where)
    .groupBy(ledgerAccount.id, ledgerAccount.balance)
    .as("per_account");

  const [row] = await db
    .select({
      accountCount: sql<string>`count(*)`,
      unreconciledCount: sql<string>`count(*) filter (where coalesce(${perAccount.computedBalance}, 0) <> ${perAccount.recordedBalance})`,
    })
    .from(perAccount);

  // `count(*)` comes back as a string from `pg` (it is `bigint` in Postgres).
  // An org cannot hold enough accounts for `Number` to lose precision here,
  // and these are counts for display, not money — no `bigint` escapes.
  return {
    accountCount: Number(row?.accountCount ?? 0),
    unreconciledCount: Number(row?.unreconciledCount ?? 0),
  };
}
