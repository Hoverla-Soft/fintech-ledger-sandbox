import { randomUUID } from "node:crypto";

import { err, ok, type AccountType, type Currency, type Result } from "@fintech-ledger-sandbox/core";
import { and, asc, eq } from "drizzle-orm";

import type { AccountNotFound } from "../errors";
import { toCurrency } from "../internal/money";
import type { Db } from "../index";
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
 * Creates an account with a zero starting balance. Uniqueness of
 * `(org_id, name)` is enforced by the schema's own unique constraint —
 * this function does not pre-check it, so a duplicate name surfaces as
 * whatever constraint-violation error the caller's Drizzle client
 * produces rather than a second, racy existence check.
 */
export async function createAccount(db: Db, input: CreateAccountInput): Promise<LedgerAccountRow> {
  const [row] = await db
    .insert(ledgerAccount)
    .values({
      id: randomUUID(),
      orgId: input.orgId,
      name: input.name,
      currency: input.currency,
      type: input.type,
    })
    .returning();

  if (row === undefined) {
    throw new Error(`insert into ledger_account for org "${input.orgId}" returned no row`);
  }

  return toAccountRow(row);
}

/** Every account for `orgId`, ordered by name. Org-scoped — never reads across tenants. */
export async function listAccounts(db: Db, orgId: string): Promise<readonly LedgerAccountRow[]> {
  const rows = await db.select().from(ledgerAccount).where(eq(ledgerAccount.orgId, orgId)).orderBy(asc(ledgerAccount.name));
  return rows.map(toAccountRow);
}

/**
 * Looks up one account by id, scoped to `orgId`. A cross-org id and a
 * genuinely missing id both report the same `AccountNotFound` — see
 * `errors.ts`.
 */
export async function getAccountById(db: Db, orgId: string, accountId: string): Promise<Result<LedgerAccountRow, AccountNotFound>> {
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
