import { randomUUID } from "node:crypto";

import {
  type AccountType,
  type Currency,
  err,
  ok,
  type Result,
} from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, or } from "drizzle-orm";

import type { AccountAlreadyExists, AccountNotEmpty, AccountNotFound } from "../errors";
import type { Db } from "../index";
import { toCurrency } from "../internal/money";
import { getPostgresErrorCode, POSTGRES_UNIQUE_VIOLATION } from "../internal/pg-errors";
import { ledgerAccount } from "../schema/ledger";
import {
  clampPageSize,
  type NameCursor,
  type Page,
  type PageRequest,
  splitPage,
} from "./pagination";

const DEFAULT_PAGE_SIZE = 50;

export interface LedgerAccountRow {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly currency: Currency;
  readonly type: AccountType;
  readonly balance: bigint;
  readonly active: boolean;
  readonly createdAt: Date;
}

export interface CreateAccountInput {
  readonly orgId: string;
  readonly name: string;
  readonly currency: Currency;
  readonly type: AccountType;
}

/**
 * Creates an account with a zero starting balance.
 *
 * Uniqueness of `(org_id, name)` is enforced by the schema's own constraint;
 * this function still does not pre-check it, because a check-then-insert is
 * racy — two concurrent requests for the same name would both pass the check.
 * The constraint stays the arbiter. What changed in Phase 4b is that its
 * violation is now *translated*: it used to escape as a raw
 * `DrizzleQueryError` and surface at the API boundary as an unhandled 500.
 *
 * Only SQLSTATE `23505` (unique violation) is converted. Any other database
 * failure is genuinely unexpected and is rethrown untouched, so a connection
 * fault or a check-constraint violation is never mislabelled as a name clash.
 */
export async function createAccount(
  db: Db,
  input: CreateAccountInput,
): Promise<Result<LedgerAccountRow, AccountAlreadyExists>> {
  let row: typeof ledgerAccount.$inferSelect | undefined;

  try {
    [row] = await db
      .insert(ledgerAccount)
      .values({
        id: randomUUID(),
        orgId: input.orgId,
        name: input.name,
        currency: input.currency,
        type: input.type,
      })
      .returning();
  } catch (caught) {
    if (getPostgresErrorCode(caught) === POSTGRES_UNIQUE_VIOLATION) {
      return err({ kind: "AccountAlreadyExists", name: input.name });
    }
    throw caught;
  }

  if (row === undefined) {
    throw new Error(`insert into ledger_account for org "${input.orgId}" returned no row`);
  }

  return ok(toAccountRow(row));
}

/**
 * Every account for `orgId`, ordered by name, **unbounded**. Org-scoped —
 * never reads across tenants.
 *
 * Kept unbounded on purpose, and not exposed on the wire. Its callers are
 * server-side operations that are only correct when they see the whole set:
 * `sandbox.reset` plans the chunk that zeroes every balance and then verifies
 * none remain, which a paged read would quietly perform over the first page
 * only — a reset that reports success while leaving balances behind. Wire
 * reads use `pageAccounts` instead.
 */
export async function listAccounts(db: Db, orgId: string): Promise<readonly LedgerAccountRow[]> {
  const rows = await db
    .select()
    .from(ledgerAccount)
    .where(eq(ledgerAccount.orgId, orgId))
    .orderBy(asc(ledgerAccount.name));
  return rows.map(toAccountRow);
}

/**
 * Cursor-paginated accounts for `orgId`, ordered by `(name, id)`.
 *
 * `name` alone would be an unstable sort key despite the `(org_id, name)`
 * unique constraint making it unique *today*: the tiebreaker costs nothing and
 * means a later change that drops or scopes that constraint cannot silently
 * turn into rows being skipped mid-walk. Same `(sort key, id)` shape as
 * `listTransactions`, for the same reason.
 */
export async function pageAccounts(
  db: Db,
  orgId: string,
  request: PageRequest<NameCursor> = {},
): Promise<Page<LedgerAccountRow, NameCursor>> {
  const limit = clampPageSize(request.limit, DEFAULT_PAGE_SIZE);
  const after = request.after;

  const cursorFilter = after
    ? or(
        gt(ledgerAccount.name, after.name),
        and(eq(ledgerAccount.name, after.name), gt(ledgerAccount.id, after.id)),
      )
    : undefined;

  const rows = await db
    .select()
    .from(ledgerAccount)
    .where(
      cursorFilter
        ? and(eq(ledgerAccount.orgId, orgId), cursorFilter)
        : eq(ledgerAccount.orgId, orgId),
    )
    .orderBy(asc(ledgerAccount.name), asc(ledgerAccount.id))
    .limit(limit + 1);

  const { pageRows, hasMore, lastRow } = splitPage(rows, limit);

  return {
    items: pageRows.map(toAccountRow),
    nextCursor: hasMore && lastRow !== undefined ? { name: lastRow.name, id: lastRow.id } : null,
  };
}

/**
 * Looks up one account by its `(org_id, name)` unique key.
 *
 * Returns `null` for a miss rather than a `Result`, because the one caller —
 * finding or opening an FX bridge account — treats absence as "create it", not
 * as an error. Reporting it as `AccountNotFound` would make every call site
 * unwrap an error that is a normal, expected outcome.
 */
export async function findAccountByName(
  db: Db,
  orgId: string,
  name: string,
): Promise<LedgerAccountRow | null> {
  const [row] = await db
    .select()
    .from(ledgerAccount)
    .where(and(eq(ledgerAccount.orgId, orgId), eq(ledgerAccount.name, name)));

  return row === undefined ? null : toAccountRow(row);
}

/**
 * Looks up one account by id, scoped to `orgId`. A cross-org id and a
 * genuinely missing id both report the same `AccountNotFound` — see
 * `errors.ts`.
 */
export async function getAccountById(
  db: Db,
  orgId: string,
  accountId: string,
): Promise<Result<LedgerAccountRow, AccountNotFound>> {
  const [row] = await db
    .select()
    .from(ledgerAccount)
    .where(and(eq(ledgerAccount.orgId, orgId), eq(ledgerAccount.id, accountId)));

  if (row === undefined) {
    return err({ kind: "AccountNotFound", accountId });
  }

  return ok(toAccountRow(row));
}

/**
 * Opens or closes an account.
 *
 * The only writer of `active`. Until now the column could be read on the wire
 * and enforced under the posting lock, but nothing could *set* it — the state
 * was reachable only by raw SQL, which is what `writes.test.ts` had to do
 * (`docs/open-questions.md` #8).
 *
 * **One conditional `UPDATE`, not a read-then-write.** Closing carries
 * `AND balance = 0` in the `WHERE`, so Postgres takes the row lock and
 * evaluates the predicate against committed state: a concurrent
 * `postTransaction` either commits first and the close then correctly fails, or
 * it blocks behind this update. Checking the balance in a separate statement
 * would leave a window for a posting to land between the check and the write,
 * closing an account that had just been funded.
 *
 * Reopening carries no balance condition. An inactive account's balance is
 * whatever it was; there is nothing to protect on the way back in.
 *
 * Idempotent by construction: closing a closed account matches the same row and
 * returns it. The caller asked for an end state and got it, and reporting a
 * conflict would make a retried request look like a failure.
 */
export async function setAccountActive(
  db: Db,
  input: { readonly orgId: string; readonly accountId: string; readonly active: boolean },
): Promise<Result<LedgerAccountRow, AccountNotFound | AccountNotEmpty>> {
  const conditions = [eq(ledgerAccount.orgId, input.orgId), eq(ledgerAccount.id, input.accountId)];
  if (!input.active) {
    conditions.push(eq(ledgerAccount.balance, 0n));
  }

  const [updated] = await db
    .update(ledgerAccount)
    .set({ active: input.active })
    .where(and(...conditions))
    .returning();

  if (updated !== undefined) {
    return ok(toAccountRow(updated));
  }

  // The update matched nothing. Only now is a second read worth doing, and only
  // to explain *why* — the call has already written nothing either way, so a
  // posting racing this read can at worst produce a slightly stale reason.
  const existing = await getAccountById(db, input.orgId, input.accountId);
  if (!existing.ok) {
    return existing;
  }
  return err({ kind: "AccountNotEmpty", accountId: input.accountId });
}

function toAccountRow(row: typeof ledgerAccount.$inferSelect): LedgerAccountRow {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    currency: toCurrency(row.currency, `ledger_account "${row.id}"`),
    type: row.type,
    balance: row.balance,
    active: row.active,
    createdAt: row.createdAt,
  };
}
