import { randomUUID } from "node:crypto";

import {
  type AccountType,
  type Currency,
  err,
  ok,
  type Result,
} from "@fintech-ledger-sandbox/core";
import { and, asc, eq } from "drizzle-orm";

import type { AccountAlreadyExists, AccountNotFound } from "../errors";
import type { Db } from "../index";
import { toCurrency } from "../internal/money";
import { getPostgresErrorCode, POSTGRES_UNIQUE_VIOLATION } from "../internal/pg-errors";
import { ledgerAccount } from "../schema/ledger";

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

/** Every account for `orgId`, ordered by name. Org-scoped — never reads across tenants. */
export async function listAccounts(db: Db, orgId: string): Promise<readonly LedgerAccountRow[]> {
  const rows = await db
    .select()
    .from(ledgerAccount)
    .where(eq(ledgerAccount.orgId, orgId))
    .orderBy(asc(ledgerAccount.name));
  return rows.map(toAccountRow);
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
