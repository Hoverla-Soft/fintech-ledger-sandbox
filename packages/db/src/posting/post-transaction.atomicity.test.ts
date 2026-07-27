import { randomUUID } from "node:crypto";

import { createPosting, Transaction } from "@fintech-ledger-sandbox/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { Db } from "../index";
import { ledgerAccount, ledgerIdempotencyKey, ledgerPosting, ledgerTransaction } from "../schema/ledger";
import { connectTestDatabase } from "../test/setup";
import { getRootCauseMessage, money, seedAccount, seedTenant, unwrap } from "../test/fixtures";
import { postTransaction } from "./post-transaction";

/**
 * Invariant #3 (docs/product/requirements/ledger.md): "a transaction fully
 * posts (all postings + all balance updates) or not at all." The task's
 * acceptance criteria name two specific injection points: a failure right
 * after the posting insert (before any balance update), and a failure
 * after the *first* of several balance updates in a multi-account
 * transfer.
 *
 * `post-transaction.ts` never has a legitimate rollback point in either
 * spot: every domain check (`applyDelta`) runs entirely in memory, before
 * any row is written, so the only way to fail there for real is a genuine
 * infrastructure-level Postgres error. This file forces exactly that with
 * a temporary, test-only trigger on `ledger_account` — created via raw SQL
 * against the (disposable) shared test container in `beforeAll` and
 * dropped in `afterAll` — rather than editing `post-transaction.ts` or
 * mocking the Drizzle client. `postTransaction` itself is never modified,
 * stubbed, or given a fake `Db`; every statement it issues still runs
 * against the real database, and the trigger's `RAISE EXCEPTION` is a real
 * Postgres error that Postgres itself rolls the whole transaction back for.
 *
 * The trigger is inert (`IF EXISTS (SELECT 1 FROM test_fail_on_account_update
 * WHERE account_id = NEW.id)` never matches) unless a test explicitly
 * inserts a target row via `failOnNextUpdateTo`, so it cannot affect any
 * other file sharing this container.
 */

async function installUpdateFailureTrigger(db: Db): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS test_fail_on_account_update (account_id text PRIMARY KEY)`);
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION test_fail_on_account_update_fn() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM test_fail_on_account_update WHERE account_id = NEW.id) THEN
        RAISE EXCEPTION 'test-injected atomicity failure updating ledger_account %', NEW.id;
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS test_fail_on_account_update_trigger ON ledger_account`);
  await db.execute(sql`
    CREATE TRIGGER test_fail_on_account_update_trigger
    BEFORE UPDATE ON ledger_account
    FOR EACH ROW
    EXECUTE FUNCTION test_fail_on_account_update_fn()
  `);
}

async function uninstallUpdateFailureTrigger(db: Db): Promise<void> {
  await db.execute(sql`DROP TRIGGER IF EXISTS test_fail_on_account_update_trigger ON ledger_account`);
  await db.execute(sql`DROP FUNCTION IF EXISTS test_fail_on_account_update_fn()`);
  await db.execute(sql`DROP TABLE IF EXISTS test_fail_on_account_update`);
}

async function failOnNextUpdateTo(db: Db, accountId: string): Promise<void> {
  await db.execute(sql`INSERT INTO test_fail_on_account_update (account_id) VALUES (${accountId})`);
}

async function clearInjectedFailures(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM test_fail_on_account_update`);
}

describe("postTransaction atomicity (invariant #3)", () => {
  let database: ReturnType<typeof connectTestDatabase>;

  beforeAll(async () => {
    database = connectTestDatabase(inject("dbTestConnectionString"));
    await installUpdateFailureTrigger(database.db);
  });

  afterAll(async () => {
    await uninstallUpdateFailureTrigger(database.db);
  });

  beforeEach(async () => {
    await database.reset();
    await clearInjectedFailures(database.db);
  });

  /** A 3-leg payroll-style transaction: funding credited for the total, alice and bob each debited. `deltas()` (and the balance-update loop that follows it) iterate in first-seen posting order, so this fixture lets each test pick exactly which account's update fails by choosing which posting comes first. */
  function buildThreeLegTransaction(fundingAccountId: string, aliceAccountId: string, bobAccountId: string): Transaction {
    return unwrap(
      Transaction.create([
        unwrap(createPosting(aliceAccountId, "debit", money("40.00"))),
        unwrap(createPosting(bobAccountId, "debit", money("60.00"))),
        unwrap(createPosting(fundingAccountId, "credit", money("100.00"))),
      ]),
    );
  }

  it("a failure injected on the very first balance update (right after the posting insert) leaves zero postings, zero transactions, and untouched balances", async () => {
    const database_ = database;
    const { orgId, actorId } = await seedTenant(database_.db);
    const funding = await seedAccount(database_.db, orgId, "external", "Funding");
    const alice = await seedAccount(database_.db, orgId, "normal", "Alice");
    const bob = await seedAccount(database_.db, orgId, "normal", "Bob");
    const transaction = buildThreeLegTransaction(funding, alice, bob);

    // alice is the first account `postTransaction`'s balance-update loop
    // reaches, so failing her update fires before *any* balance update
    // succeeds — "after posting insert, before balance update".
    await failOnNextUpdateTo(database_.db, alice);

    let caught: unknown;
    try {
      await postTransaction(database_.db, {
        orgId,
        actorId,
        idempotencyKey: randomUUID(),
        requestHash: "atomicity-injection-1",
        transaction,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(getRootCauseMessage(caught)).toContain("test-injected atomicity failure");

    const [fundingRow] = await database_.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, funding));
    const [aliceRow] = await database_.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, alice));
    const [bobRow] = await database_.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, bob));
    expect(fundingRow?.balance).toBe(0n);
    expect(aliceRow?.balance).toBe(0n);
    expect(bobRow?.balance).toBe(0n);

    const transactions = await database_.db.select().from(ledgerTransaction).where(eq(ledgerTransaction.orgId, orgId));
    expect(transactions).toHaveLength(0);

    const postings = await database_.db.select().from(ledgerPosting).where(eq(ledgerPosting.orgId, orgId));
    expect(postings).toHaveLength(0);

    // The idempotency reservation is the very first write in the routine —
    // it must roll back too, not just the postings/balances the acceptance
    // criteria call out by name.
    const idempotencyRows = await database_.db.select().from(ledgerIdempotencyKey).where(eq(ledgerIdempotencyKey.orgId, orgId));
    expect(idempotencyRows).toHaveLength(0);
  });

  it("a failure injected on the second balance update (in a 3-account transfer) rolls back the already-applied first update too", async () => {
    const database_ = database;
    const { orgId, actorId } = await seedTenant(database_.db);
    const funding = await seedAccount(database_.db, orgId, "external", "Funding");
    const alice = await seedAccount(database_.db, orgId, "normal", "Alice");
    const bob = await seedAccount(database_.db, orgId, "normal", "Bob");
    const transaction = buildThreeLegTransaction(funding, alice, bob);

    // alice's update is allowed to succeed for real; bob's (the second
    // account reached) then fails — "after the first balance update".
    await failOnNextUpdateTo(database_.db, bob);

    let caught: unknown;
    try {
      await postTransaction(database_.db, {
        orgId,
        actorId,
        idempotencyKey: randomUUID(),
        requestHash: "atomicity-injection-2",
        transaction,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(getRootCauseMessage(caught)).toContain("test-injected atomicity failure");

    const [fundingRow] = await database_.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, funding));
    const [aliceRow] = await database_.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, alice));
    const [bobRow] = await database_.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, bob));
    // The crux of this test: alice's update genuinely executed inside the
    // transaction before bob's failed, yet her balance is still exactly
    // what it was before — Postgres rolled the whole transaction back,
    // including the already-applied statement.
    expect(fundingRow?.balance).toBe(0n);
    expect(aliceRow?.balance).toBe(0n);
    expect(bobRow?.balance).toBe(0n);

    const transactions = await database_.db.select().from(ledgerTransaction).where(eq(ledgerTransaction.orgId, orgId));
    expect(transactions).toHaveLength(0);

    const postings = await database_.db.select().from(ledgerPosting).where(eq(ledgerPosting.orgId, orgId));
    expect(postings).toHaveLength(0);

    const idempotencyRows = await database_.db.select().from(ledgerIdempotencyKey).where(eq(ledgerIdempotencyKey.orgId, orgId));
    expect(idempotencyRows).toHaveLength(0);
  });
});
