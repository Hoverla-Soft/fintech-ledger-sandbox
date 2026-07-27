import { randomUUID } from "node:crypto";

import {
  createPosting,
  Money,
  Transaction,
  type AccountType,
  type Currency,
  type Result,
} from "@fintech-ledger-sandbox/core";
import { createDb, type Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { createAccount } from "@fintech-ledger-sandbox/db/repositories";
import { user } from "@fintech-ledger-sandbox/db/schema/auth";
import { member, organization } from "@fintech-ledger-sandbox/db/schema/organization";
import { createRouterClient, type RouterClient } from "@orpc/server";

import type { Context, LedgerSession } from "../context";
import { appRouter } from "../routers/index";

/**
 * Fixtures for the API suite.
 *
 * Distinct from `packages/db`'s own fixtures, which are internal to that
 * package and seed only what the persistence tests need. These additionally
 * create the **`member` row** every test here depends on — without it
 * `orgProcedure` correctly rejects with `403`, so a missing membership is the
 * difference between testing the read surface and testing the middleware's
 * rejection path.
 */

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected an ok Result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export interface SeededTenant {
  readonly orgId: string;
  readonly userId: string;
}

/**
 * Creates an organization, a user, and the `member` row binding them.
 *
 * `betterAuthRole` is the raw string stored in `member.role` — Better Auth's
 * vocabulary (`owner` / `admin` / `member`), not the ledger's. Tests pass it
 * verbatim so the `toLedgerRole` mapping is exercised end to end through the
 * middleware rather than stubbed.
 */
export async function seedTenant(
  db: Db,
  namePrefix = "Api",
  betterAuthRole = "owner",
): Promise<SeededTenant> {
  const orgId = randomUUID();
  const userId = randomUUID();

  await db.insert(organization).values({
    id: orgId,
    name: `${namePrefix} Org ${orgId}`,
    slug: `${namePrefix.toLowerCase()}-${orgId}`,
  });
  await db.insert(user).values({
    id: userId,
    name: `${namePrefix} User`,
    email: `${userId}@example.com`,
  });
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: orgId,
    userId,
    role: betterAuthRole,
  });

  return { orgId, userId };
}

/** Creates a user with no `member` row anywhere — for the `403 not_a_member` path. */
export async function seedOrphanUser(db: Db): Promise<string> {
  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    name: "Orphan",
    email: `${userId}@example.com`,
  });
  return userId;
}

/**
 * Creates a zero-balance account through `packages/db`'s public
 * `createAccount` repository rather than a raw insert.
 *
 * `packages/db`'s own fixtures insert into `ledgerAccount` directly, but they
 * can — they live inside that package. `schema/ledger` is not in its export
 * map, and reaching around a package's public entry point is exactly what
 * CLAUDE.md forbids. Using the repository is also simply more honest: it is
 * the same call Phase 4b's `accounts.create` will make.
 */
export async function seedAccount(
  db: Db,
  orgId: string,
  type: AccountType,
  name: string,
  currency: Currency = "USD",
): Promise<string> {
  const account = await createAccount(db, { orgId, name, currency, type });
  return account.id;
}

export function money(decimal: string, currency: Currency = "USD"): Money {
  return unwrap(Money.parse(decimal, currency));
}

/** A balanced 2-leg transfer: `from` is credited, `to` is debited. Mirrors `packages/db`'s convention. */
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
 * Posts a real transfer through the production write path.
 *
 * The read endpoints under test have to return rows that were written the way
 * production writes them — postings, balances, idempotency row, and audit
 * entry all committed together. Hand-inserting rows would let a mapper bug
 * hide behind fixture data that never looked like the real thing.
 */
export async function postTransfer(
  db: Db,
  tenant: SeededTenant,
  fromAccountId: string,
  toAccountId: string,
  amountDecimal: string,
): Promise<string> {
  const posted = await postTransaction(db, {
    orgId: tenant.orgId,
    actorId: tenant.userId,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    transaction: buildTransfer(fromAccountId, toAccountId, amountDecimal),
  });

  return unwrap(posted).transactionId;
}

/** Builds a request context directly, bypassing Better Auth — see `context.ts` on why `LedgerSession` is this package's own minimal shape. */
export function contextFor(db: Db, session: LedgerSession | null): Context {
  return { db, session };
}

/** A typed, in-process client over the real router: real middleware, real repositories, real SQL, no HTTP. */
export function clientFor(db: Db, session: LedgerSession | null): RouterClient<typeof appRouter> {
  return createRouterClient(appRouter, { context: contextFor(db, session) });
}

/** A signed-in session acting within `tenant`'s organization. */
export function sessionFor(tenant: SeededTenant): LedgerSession {
  return { userId: tenant.userId, activeOrganizationId: tenant.orgId };
}

/** Binds a `Db` to the container started by `global-setup.ts`. */
export function connect(connectionString: string): Db {
  return createDb(connectionString);
}
