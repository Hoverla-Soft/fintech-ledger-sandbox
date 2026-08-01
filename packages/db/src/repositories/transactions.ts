import {
  CURRENCIES,
  type Currency,
  err,
  Money,
  ok,
  type PostingDirection,
  type Result,
} from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { TransactionNotFound } from "../errors";
import type { Db } from "../index";
import { toCurrency, toMoney } from "../internal/money";
import { ledgerPosting, ledgerTransaction } from "../schema/ledger";
import {
  clampPageSize,
  type Page,
  type PageRequest,
  splitPage,
  type TimeCursor,
} from "./pagination";

const DEFAULT_PAGE_SIZE = 50;

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
  /**
   * On the **target** leg of a cross-currency exchange: the source leg it was
   * converted from. `null` on everything else.
   */
  readonly fxSourceTransactionId: string | null;
  /**
   * On the **source** leg of an exchange: the target leg it converted into.
   * `null` on everything else.
   *
   * Derived per read as the inverse of `fx_source_transaction_id`, never stored
   * — the same treatment `reversedBy` gets, and for the same reason.
   *
   * A **scalar**, unlike `reversedBy`, and the difference is structural rather
   * than stylistic. A transaction may be reversed any number of times, so that
   * one has to be a list. An exchange source has exactly one target, and
   * migration `0005` enforces it with a partial UNIQUE index on
   * `fx_source_transaction_id` — so this cannot quietly become wrong the way a
   * scalar `reversedBy` would have.
   */
  readonly fxTargetTransactionId: string | null;
  /** The agreed rate, as text, on the target leg of an exchange. `null` on everything else. */
  readonly fxRate: string | null;
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

export interface ListTransactionsInput extends PageRequest<TimeCursor> {
  readonly orgId: string;
  /** Only transactions that posted a leg against this account. */
  readonly accountId?: string;
  /** ISO currency code filter. */
  readonly currency?: string;
  /** Inclusive lower bound on `created_at`. */
  readonly createdAfter?: Date;
  /** Exclusive upper bound on `created_at`. */
  readonly createdBefore?: Date;
  /**
   * Inclusive lower/upper bounds on the transaction's **debit-side total**
   * (sum of debit posting minor units), interpreted with each row's currency
   * via `Money.parse`.
   */
  readonly minAmount?: string;
  readonly maxAmount?: string;
  /** Restrict to reversals, non-reversals, or leave unrestricted. */
  readonly kind?: "transfers" | "reversals";
}

export type TransactionsPage = Page<LedgerTransactionWithPostings, TimeCursor>;

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
/**
 * Which of `transactionIds` are exchange *sources*, and what each converted
 * into.
 *
 * One query for the whole page, like the reversal lookup beside it. Returns a
 * `Map` rather than an object for the same prototype-pollution reason recorded
 * there — transaction ids are opaque strings, and `"__proto__"` as an object key
 * resolves through the prototype chain instead of reporting a miss.
 */
async function loadFxTargetsBySourceId(
  db: Db,
  orgId: string,
  transactionIds: readonly string[],
): Promise<Map<string, string>> {
  const bySourceId = new Map<string, string>();
  if (transactionIds.length === 0) {
    return bySourceId;
  }

  const rows = await db
    .select({ id: ledgerTransaction.id, source: ledgerTransaction.fxSourceTransactionId })
    .from(ledgerTransaction)
    .where(
      and(
        eq(ledgerTransaction.orgId, orgId),
        isNotNull(ledgerTransaction.fxSourceTransactionId),
        inArray(ledgerTransaction.fxSourceTransactionId, [...transactionIds]),
      ),
    );

  for (const row of rows) {
    if (row.source !== null) {
      bySourceId.set(row.source, row.id);
    }
  }

  return bySourceId;
}

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
 *
 * Optional filters are applied in SQL (not after `LIMIT`) so a page never
 * silently under-fills because matching rows were discarded client-side.
 */
export async function listTransactions(
  db: Db,
  input: ListTransactionsInput,
): Promise<TransactionsPage> {
  const limit = clampPageSize(input.limit, DEFAULT_PAGE_SIZE);

  const cursorFilter = input.after
    ? or(
        gt(ledgerTransaction.createdAt, input.after.createdAt),
        and(
          eq(ledgerTransaction.createdAt, input.after.createdAt),
          gt(ledgerTransaction.id, input.after.id),
        ),
      )
    : undefined;

  const filters = [eq(ledgerTransaction.orgId, input.orgId)];

  if (cursorFilter) {
    filters.push(cursorFilter);
  }
  if (input.currency !== undefined) {
    filters.push(eq(ledgerTransaction.currency, input.currency));
  }
  if (input.createdAfter !== undefined) {
    filters.push(gte(ledgerTransaction.createdAt, input.createdAfter));
  }
  if (input.createdBefore !== undefined) {
    filters.push(lt(ledgerTransaction.createdAt, input.createdBefore));
  }
  if (input.kind === "reversals") {
    filters.push(isNotNull(ledgerTransaction.reversesTransactionId));
  } else if (input.kind === "transfers") {
    filters.push(isNull(ledgerTransaction.reversesTransactionId));
  }
  if (input.accountId !== undefined) {
    filters.push(
      inArray(
        ledgerTransaction.id,
        db
          .select({ id: ledgerPosting.transactionId })
          .from(ledgerPosting)
          .where(
            and(eq(ledgerPosting.orgId, input.orgId), eq(ledgerPosting.accountId, input.accountId)),
          ),
      ),
    );
  }

  const amountClause = debitAmountFilter(input.minAmount, input.maxAmount);
  if (amountClause !== undefined) {
    filters.push(amountClause);
  }

  const whereClause = and(...filters);

  // Fetch one extra row to know whether another page exists without a second count query.
  const rows = await db
    .select()
    .from(ledgerTransaction)
    .where(whereClause)
    .orderBy(asc(ledgerTransaction.createdAt), asc(ledgerTransaction.id))
    .limit(limit + 1);

  const { pageRows, hasMore, lastRow } = splitPage(rows, limit);

  // Two batched lookups for the whole page, issued together — constant in
  // page size, not one pair per row.
  const pageIds = pageRows.map((row) => row.id);
  const [postingsByTransactionId, reversalsByTransactionId, fxTargetsBySourceId] =
    await Promise.all([
      loadPostingsByTransactionId(db, input.orgId, pageIds),
      loadReversalsByTransactionId(db, input.orgId, pageIds),
      loadFxTargetsBySourceId(db, input.orgId, pageIds),
    ]);

  return {
    items: pageRows.map((row) => ({
      ...toTransactionRow(
        row,
        reversalsByTransactionId.get(row.id) ?? [],
        fxTargetsBySourceId.get(row.id) ?? null,
      ),
      postings: postingsByTransactionId.get(row.id) ?? [],
    })),
    nextCursor:
      hasMore && lastRow !== undefined ? { createdAt: lastRow.createdAt, id: lastRow.id } : null,
  };
}

/**
 * Debit-total amount bounds, OR'd across currencies that can parse the bound
 * strings. A bound that is illegal for every known currency matches nothing
 * (`false`) rather than throwing — the API layer should reject that earlier.
 */
function debitAmountFilter(minAmount?: string, maxAmount?: string) {
  if (minAmount === undefined && maxAmount === undefined) {
    return undefined;
  }

  const debitTotal = sql`(
    select coalesce(sum(${ledgerPosting.amount}), 0)
    from ${ledgerPosting}
    where ${ledgerPosting.transactionId} = ${ledgerTransaction.id}
      and ${ledgerPosting.orgId} = ${ledgerTransaction.orgId}
      and ${ledgerPosting.direction} = 'debit'
  )`;

  const branches = [];
  for (const currency of CURRENCIES) {
    const min = minAmount === undefined ? null : Money.parse(minAmount, currency);
    const max = maxAmount === undefined ? null : Money.parse(maxAmount, currency);
    if (minAmount !== undefined && min !== null && !min.ok) {
      continue;
    }
    if (maxAmount !== undefined && max !== null && !max.ok) {
      continue;
    }
    const parts = [eq(ledgerTransaction.currency, currency)];
    if (min?.ok) {
      parts.push(sql`${debitTotal} >= ${min.value.minorUnits}`);
    }
    if (max?.ok) {
      parts.push(sql`${debitTotal} <= ${max.value.minorUnits}`);
    }
    branches.push(and(...parts));
  }

  if (branches.length === 0) {
    return sql`false`;
  }
  return or(...branches);
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

  const [postingRows, reversalsByTransactionId, fxTargetsBySourceId] = await Promise.all([
    db
      .select()
      .from(ledgerPosting)
      .where(and(eq(ledgerPosting.orgId, orgId), eq(ledgerPosting.transactionId, transactionId)))
      .orderBy(asc(ledgerPosting.createdAt)),
    loadReversalsByTransactionId(db, orgId, [transactionId]),
    loadFxTargetsBySourceId(db, orgId, [transactionId]),
  ]);

  return ok({
    ...toTransactionRow(
      transactionRow,
      reversalsByTransactionId.get(transactionId) ?? [],
      fxTargetsBySourceId.get(transactionId) ?? null,
    ),
    postings: postingRows.map(toPostingRow),
  });
}

function toTransactionRow(
  row: typeof ledgerTransaction.$inferSelect,
  reversedBy: readonly string[],
  fxTargetTransactionId: string | null,
): LedgerTransactionRow {
  return {
    id: row.id,
    orgId: row.orgId,
    currency: toCurrency(row.currency, `ledger_transaction "${row.id}"`),
    reversesTransactionId: row.reversesTransactionId,
    reversedBy,
    fxSourceTransactionId: row.fxSourceTransactionId,
    fxTargetTransactionId,
    fxRate: row.fxRate,
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
