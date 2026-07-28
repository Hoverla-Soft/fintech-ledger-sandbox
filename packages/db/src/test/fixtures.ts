import { randomUUID } from "node:crypto";

import {
  type AccountType,
  type Currency,
  createPosting,
  Money,
  type Result,
  Transaction,
} from "@fintech-ledger-sandbox/core";

import type { Db } from "../index";
import { user } from "../schema/auth";
import { ledgerAccount } from "../schema/ledger";
import { organization } from "../schema/organization";

/**
 * Shared fixtures for `packages/db`'s acceptance suite
 * (`docs/product/requirements/ledger.md` invariants #2-#8). Internal to
 * this package — `test/` is never part of the public export map, same as
 * `test/setup.ts` — every acceptance test file imports these via a
 * relative path. Centralizes the org/user/account seeding
 * `posting/post-transaction.test.ts` (the pre-existing smoke test) defines
 * inline, since the acceptance suite spans several files that all need the
 * same scaffolding.
 */

/** Unwraps an `ok` `Result`, throwing with the error payload otherwise. Every fixture builder below is expected to succeed; a thrown error surfaces a fixture bug immediately instead of a confusing downstream assertion failure. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected an ok Result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export interface SeededTenant {
  readonly orgId: string;
  readonly actorId: string;
}

/** Creates one organization and one user to act as its admin, satisfying `postTransaction`'s `org_id` / `created_by` / `actor_user_id` FKs. */
export async function seedTenant(db: Db, namePrefix = "Acceptance"): Promise<SeededTenant> {
  const orgId = randomUUID();
  const actorId = randomUUID();

  await db.insert(organization).values({
    id: orgId,
    name: `${namePrefix} Org ${orgId}`,
    slug: `${namePrefix.toLowerCase()}-${orgId}`,
  });
  await db
    .insert(user)
    .values({ id: actorId, name: `${namePrefix} Actor`, email: `${actorId}@example.com` });

  return { orgId, actorId };
}

/** Creates a zero-balance ledger account for `orgId`. */
export async function seedAccount(
  db: Db,
  orgId: string,
  type: AccountType,
  name: string,
  currency: Currency = "USD",
): Promise<string> {
  const id = randomUUID();
  await db.insert(ledgerAccount).values({ id, orgId, name, currency, type });
  return id;
}

/** Parses a decimal amount into `Money`, throwing on a malformed fixture literal rather than returning a `Result` every call site must unwrap. */
export function money(decimal: string, currency: Currency = "USD"): Money {
  return unwrap(Money.parse(decimal, currency));
}

/**
 * A balanced 2-leg transfer: `amountDecimal` moves from `fromAccountId`
 * (credited — its balance decreases) to `toAccountId` (debited — its
 * balance increases). Mirrors the smoke test's posting convention.
 */
export function buildTransfer(
  fromAccountId: string,
  toAccountId: string,
  amountDecimal: string,
  currency: Currency = "USD",
): Transaction {
  const amount = money(amountDecimal, currency);
  return unwrap(
    Transaction.create([
      unwrap(createPosting(toAccountId, "debit", amount)),
      unwrap(createPosting(fromAccountId, "credit", amount)),
    ]),
  );
}

/**
 * Walks an error's `cause` chain to find the deepest message text —
 * `DrizzleQueryError.message` is just `"Failed query: ...\nparams: ..."`;
 * the actual Postgres error (e.g. a `RAISE EXCEPTION` from a trigger) lives
 * on `.cause`. Bounded depth guards against an unexpected circular chain,
 * same defensive shape as `posting/reserve-key.ts`'s `getPostgresErrorCode`.
 */
export function getRootCauseMessage(error: unknown, depth = 0): string {
  if (depth > 5 || !(error instanceof Error)) {
    return String(error);
  }
  if (error.cause instanceof Error) {
    return getRootCauseMessage(error.cause, depth + 1);
  }
  return error.message;
}
