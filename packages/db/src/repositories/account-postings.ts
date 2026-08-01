import type { Money, PostingDirection } from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, lt, or, sql } from "drizzle-orm";

import type { Db } from "../index";
import { toMoney } from "../internal/money";
import { ledgerPosting } from "../schema/ledger";
import {
  clampPageSize,
  type Page,
  type PageRequest,
  splitPage,
  type TimeCursor,
} from "./pagination";

const DEFAULT_PAGE_SIZE = 50;

export interface AccountPostingRow {
  readonly id: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amount: Money;
  /** Signed cumulative balance after this posting (debit +, credit −). */
  readonly runningBalance: Money;
  readonly createdAt: Date;
}

export interface ListAccountPostingsInput extends PageRequest<TimeCursor> {
  readonly orgId: string;
  readonly accountId: string;
}

export type AccountPostingsPage = Page<AccountPostingRow, TimeCursor>;

function signedDelta(direction: PostingDirection, amount: bigint): bigint {
  return direction === "debit" ? amount : -amount;
}

/**
 * Statement-ordered postings for one account, with a running balance.
 *
 * Oldest first — the natural statement walk. Running balance is the signed
 * sum of every posting up to and including the row (debit +, credit −), matching
 * reconciliation's `signed Σ(postings)` convention.
 */
export async function pageAccountPostings(
  db: Db,
  input: ListAccountPostingsInput,
): Promise<AccountPostingsPage> {
  const limit = clampPageSize(input.limit, DEFAULT_PAGE_SIZE);

  const cursorFilter = input.after
    ? or(
        gt(ledgerPosting.createdAt, input.after.createdAt),
        and(
          eq(ledgerPosting.createdAt, input.after.createdAt),
          gt(ledgerPosting.id, input.after.id),
        ),
      )
    : undefined;

  const scope = and(
    eq(ledgerPosting.orgId, input.orgId),
    eq(ledgerPosting.accountId, input.accountId),
  );
  const whereClause = cursorFilter ? and(scope, cursorFilter) : scope;

  const rows = await db
    .select()
    .from(ledgerPosting)
    .where(whereClause)
    .orderBy(asc(ledgerPosting.createdAt), asc(ledgerPosting.id))
    .limit(limit + 1);

  const { pageRows, hasMore, lastRow } = splitPage(rows, limit);

  let running = 0n;
  if (input.after) {
    // Sum of every posting already consumed (at or before the cursor).
    const [sumRow] = await db
      .select({
        total: sql<
          string | null
        >`sum(case when ${ledgerPosting.direction} = 'debit' then ${ledgerPosting.amount} else -${ledgerPosting.amount} end)`,
      })
      .from(ledgerPosting)
      .where(
        and(
          eq(ledgerPosting.orgId, input.orgId),
          eq(ledgerPosting.accountId, input.accountId),
          or(
            lt(ledgerPosting.createdAt, input.after.createdAt),
            and(
              eq(ledgerPosting.createdAt, input.after.createdAt),
              sql`${ledgerPosting.id} <= ${input.after.id}`,
            ),
          ),
        ),
      );
    running = sumRow?.total == null ? 0n : BigInt(sumRow.total);
  }

  const items: AccountPostingRow[] = pageRows.map((row) => {
    running += signedDelta(row.direction, row.amount);
    return {
      id: row.id,
      transactionId: row.transactionId,
      accountId: row.accountId,
      direction: row.direction,
      amount: toMoney(row.amount, row.currency, `ledger_posting "${row.id}"`),
      runningBalance: toMoney(running, row.currency, `ledger_posting "${row.id}" running`),
      createdAt: row.createdAt,
    };
  });

  return {
    items,
    nextCursor:
      hasMore && lastRow !== undefined ? { createdAt: lastRow.createdAt, id: lastRow.id } : null,
  };
}
