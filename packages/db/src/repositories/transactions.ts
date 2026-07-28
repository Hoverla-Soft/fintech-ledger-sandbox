import {
  type Currency,
  err,
  type Money,
  ok,
  type PostingDirection,
  type Result,
} from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, or } from "drizzle-orm";
import type { TransactionNotFound } from "../errors";
import type { Db } from "../index";
import { toCurrency, toMoney } from "../internal/money";
import { ledgerPosting, ledgerTransaction } from "../schema/ledger";

const DEFAULT_PAGE_SIZE = 50;
/** Server-controlled cap — a caller cannot request an unbounded page regardless of what it asks for. */
const MAX_PAGE_SIZE = 200;

export interface LedgerTransactionRow {
  readonly id: string;
  readonly orgId: string;
  readonly currency: Currency;
  readonly reversesTransactionId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface LedgerPostingRow {
  readonly id: string;
  readonly orgId: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amount: Money;
  readonly createdAt: Date;
}

export interface LedgerTransactionWithPostings extends LedgerTransactionRow {
  readonly postings: readonly LedgerPostingRow[];
}

/** Opaque cursor position: the composite `(org_id, created_at, id)` index this repository paginates on. */
export interface TransactionCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface ListTransactionsInput {
  readonly orgId: string;
  readonly limit?: number;
  readonly after?: TransactionCursor;
}

export interface TransactionsPage {
  readonly items: readonly LedgerTransactionRow[];
  readonly nextCursor: TransactionCursor | null;
}

/**
 * Cursor-paginated, org-scoped transaction history ordered by
 * `(created_at, id)` — the same tiebreaker order as the
 * `ledger_transaction_orgId_createdAt_id_idx` index this query relies on,
 * so pagination is stable even when multiple rows share a `created_at`.
 */
export async function listTransactions(
  db: Db,
  input: ListTransactionsInput,
): Promise<TransactionsPage> {
  const limit = clampPageSize(input.limit);

  const cursorFilter = input.after
    ? or(
        gt(ledgerTransaction.createdAt, input.after.createdAt),
        and(
          eq(ledgerTransaction.createdAt, input.after.createdAt),
          gt(ledgerTransaction.id, input.after.id),
        ),
      )
    : undefined;

  const whereClause = cursorFilter
    ? and(eq(ledgerTransaction.orgId, input.orgId), cursorFilter)
    : eq(ledgerTransaction.orgId, input.orgId);

  // Fetch one extra row to know whether another page exists without a second count query.
  const rows = await db
    .select()
    .from(ledgerTransaction)
    .where(whereClause)
    .orderBy(asc(ledgerTransaction.createdAt), asc(ledgerTransaction.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(toTransactionRow),
    nextCursor:
      hasMore && lastRow !== undefined ? { createdAt: lastRow.createdAt, id: lastRow.id } : null,
  };
}

/**
 * One transaction with its full posting set, scoped to `orgId`. A
 * cross-org id and a genuinely missing id both report the same
 * `TransactionNotFound` — see `errors.ts`.
 */
export async function getTransactionById(
  db: Db,
  orgId: string,
  transactionId: string,
): Promise<Result<LedgerTransactionWithPostings, TransactionNotFound>> {
  const [transactionRow] = await db
    .select()
    .from(ledgerTransaction)
    .where(and(eq(ledgerTransaction.orgId, orgId), eq(ledgerTransaction.id, transactionId)));

  if (transactionRow === undefined) {
    return err({ kind: "TransactionNotFound", transactionId });
  }

  const postingRows = await db
    .select()
    .from(ledgerPosting)
    .where(and(eq(ledgerPosting.orgId, orgId), eq(ledgerPosting.transactionId, transactionId)))
    .orderBy(asc(ledgerPosting.createdAt));

  return ok({
    ...toTransactionRow(transactionRow),
    postings: postingRows.map(toPostingRow),
  });
}

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

function toTransactionRow(row: typeof ledgerTransaction.$inferSelect): LedgerTransactionRow {
  return {
    id: row.id,
    orgId: row.orgId,
    currency: toCurrency(row.currency, `ledger_transaction "${row.id}"`),
    reversesTransactionId: row.reversesTransactionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toPostingRow(row: typeof ledgerPosting.$inferSelect): LedgerPostingRow {
  return {
    id: row.id,
    orgId: row.orgId,
    transactionId: row.transactionId,
    accountId: row.accountId,
    direction: row.direction,
    amount: toMoney(row.amount, row.currency, `ledger_posting "${row.id}"`),
    createdAt: row.createdAt,
  };
}
