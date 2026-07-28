import {
  type Currency,
  err,
  type Money,
  ok,
  type PostingDirection,
  type Result,
} from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
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
  /**
   * Ids of the transactions that reverse **this** one — the inverse of
   * `reversesTransactionId`, which only ever points forwards.
   *
   * Derived per read from `ledger_transaction.reverses_transaction_id`, never
   * stored. A denormalized column would need a backfill, a write-path update,
   * and an invariant keeping the two in agreement; the database can already
   * answer the question, and migration 0004 gives it the partial index to do
   * so without a sequential scan.
   *
   * An **array**, not a boolean or a single id: nothing forbids reversing the
   * same transaction twice. There is no unique constraint on
   * `reverses_transaction_id` and `transactions.reverse` performs no
   * existing-reversal check, so a scalar would be correct until the first
   * double reversal and quietly wrong forever after.
   *
   * Empty for the overwhelming majority of transactions.
   */
  readonly reversedBy: readonly string[];
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
  readonly items: readonly LedgerTransactionWithPostings[];
  readonly nextCursor: TransactionCursor | null;
}

/**
 * Which of `transactionIds` have been reversed, and by what.
 *
 * One query for the whole page rather than one per row. The page size is
 * already capped at `MAX_PAGE_SIZE`, so the `IN` list is bounded by
 * construction and cannot grow with the size of the table.
 *
 * Returns a `Map` rather than an object: transaction ids are opaque strings
 * from the database, and an object keyed by them would resolve `"__proto__"`
 * and `"constructor"` through the prototype chain instead of reporting a
 * miss. `packages/core`'s currency parser guards the same hazard, and Phase
 * 5g shipped a real bug from exactly this pattern.
 */
async function loadReversalsByTransactionId(
  db: Db,
  orgId: string,
  transactionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byReversedId = new Map<string, string[]>();
  if (transactionIds.length === 0) {
    return byReversedId;
  }

  const rows = await db
    .select({ id: ledgerTransaction.id, reverses: ledgerTransaction.reversesTransactionId })
    .from(ledgerTransaction)
    .where(
      and(
        eq(ledgerTransaction.orgId, orgId),
        isNotNull(ledgerTransaction.reversesTransactionId),
        inArray(ledgerTransaction.reversesTransactionId, [...transactionIds]),
      ),
    )
    .orderBy(asc(ledgerTransaction.createdAt), asc(ledgerTransaction.id));

  for (const row of rows) {
    if (row.reverses === null) {
      continue;
    }
    const existing = byReversedId.get(row.reverses);
    if (existing === undefined) {
      byReversedId.set(row.reverses, [row.id]);
    } else {
      existing.push(row.id);
    }
  }

  return byReversedId;
}

/**
 * Every posting for `transactionIds`, grouped by transaction.
 *
 * One `IN` query for the page, covered by
 * `ledger_posting_transactionId_idx`. This is what makes amounts on the
 * history list a *constant* two queries per page rather than the N+1 that
 * `docs/open-questions.md` #2 rejected — that objection described the client
 * calling `transactions.get` per row, which is a different cost entirely.
 */
async function loadPostingsByTransactionId(
  db: Db,
  orgId: string,
  transactionIds: readonly string[],
): Promise<Map<string, LedgerPostingRow[]>> {
  const byTransactionId = new Map<string, LedgerPostingRow[]>();
  if (transactionIds.length === 0) {
    return byTransactionId;
  }

  const rows = await db
    .select()
    .from(ledgerPosting)
    .where(
      and(
        eq(ledgerPosting.orgId, orgId),
        inArray(ledgerPosting.transactionId, [...transactionIds]),
      ),
    )
    .orderBy(asc(ledgerPosting.createdAt), asc(ledgerPosting.id));

  for (const row of rows) {
    const posting = toPostingRow(row);
    const existing = byTransactionId.get(row.transactionId);
    if (existing === undefined) {
      byTransactionId.set(row.transactionId, [posting]);
    } else {
      existing.push(posting);
    }
  }

  return byTransactionId;
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

  // Two batched lookups for the whole page, issued together — constant in
  // page size, not one pair per row.
  const pageIds = pageRows.map((row) => row.id);
  const [postingsByTransactionId, reversalsByTransactionId] = await Promise.all([
    loadPostingsByTransactionId(db, input.orgId, pageIds),
    loadReversalsByTransactionId(db, input.orgId, pageIds),
  ]);

  return {
    items: pageRows.map((row) => ({
      ...toTransactionRow(row, reversalsByTransactionId.get(row.id) ?? []),
      postings: postingsByTransactionId.get(row.id) ?? [],
    })),
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

  const [postingRows, reversalsByTransactionId] = await Promise.all([
    db
      .select()
      .from(ledgerPosting)
      .where(and(eq(ledgerPosting.orgId, orgId), eq(ledgerPosting.transactionId, transactionId)))
      .orderBy(asc(ledgerPosting.createdAt)),
    loadReversalsByTransactionId(db, orgId, [transactionId]),
  ]);

  return ok({
    ...toTransactionRow(transactionRow, reversalsByTransactionId.get(transactionId) ?? []),
    postings: postingRows.map(toPostingRow),
  });
}

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

function toTransactionRow(
  row: typeof ledgerTransaction.$inferSelect,
  reversedBy: readonly string[],
): LedgerTransactionRow {
  return {
    id: row.id,
    orgId: row.orgId,
    currency: toCurrency(row.currency, `ledger_transaction "${row.id}"`),
    reversesTransactionId: row.reversesTransactionId,
    reversedBy,
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
