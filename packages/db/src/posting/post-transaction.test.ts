import { randomUUID } from "node:crypto";

import { createPosting, Money, type Result, Transaction } from "@fintech-ledger-sandbox/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { user } from "../schema/auth";
import {
  ledgerAccount,
  ledgerAuditEntry,
  ledgerPosting,
  ledgerTransaction,
} from "../schema/ledger";
import { organization } from "../schema/organization";
import { startTestDatabase, type TestDatabase } from "../test/setup";
import { postTransaction } from "./post-transaction";

/**
 * Smoke tests only — proving the Testcontainers harness works end to end
 * (container boots, migrations apply, `postTransaction` commits and
 * rejects correctly). The full per-invariant + `ledger.md` scenario suite
 * is a separate, later pass; this file is deliberately small.
 */

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected an ok Result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function seedTenant(database: TestDatabase) {
  const orgId = randomUUID();
  const actorId = randomUUID();

  await database.db
    .insert(organization)
    .values({ id: orgId, name: "Smoke Test Org", slug: `smoke-test-${orgId}` });
  await database.db
    .insert(user)
    .values({ id: actorId, name: "Smoke Test Admin", email: `${actorId}@example.com` });

  return { orgId, actorId };
}

async function seedAccount(
  database: TestDatabase,
  orgId: string,
  type: "normal" | "external",
  name: string,
) {
  const id = randomUUID();
  await database.db.insert(ledgerAccount).values({ id, orgId, name, currency: "USD", type });
  return id;
}

describe("postTransaction (Testcontainers integration smoke test)", () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    // Guard against `beforeAll` itself having thrown (e.g. no reachable
    // Docker daemon) — without this, a genuine "Docker unavailable"
    // failure gets masked by a confusing secondary
    // `Cannot read properties of undefined` error from this hook.
    await database?.stop();
  });

  /** Non-null accessor for `database` — always defined by the time a `beforeEach`/`it` body runs, since `beforeAll` either assigns it or throws (which skips the rest of the suite). */
  function getDatabase(): TestDatabase {
    if (database === undefined) {
      throw new Error("test database was not initialized — beforeAll must have failed");
    }
    return database;
  }

  beforeEach(async () => {
    await getDatabase().reset();
  });

  it("posts a balanced transfer atomically: both balances update and one audit entry is recorded", async () => {
    const database = getDatabase();
    const { orgId, actorId } = await seedTenant(database);
    // `external` models money entering the sandbox (may go negative) —
    // the funding side of this transfer; `normal` is the receiving
    // customer-style account (may never go negative).
    const externalAccountId = await seedAccount(database, orgId, "external", "Funding");
    const normalAccountId = await seedAccount(database, orgId, "normal", "Customer");

    const amount = unwrap(Money.parse("100.00", "USD"));
    const transaction = unwrap(
      Transaction.create([
        unwrap(createPosting(normalAccountId, "debit", amount)),
        unwrap(createPosting(externalAccountId, "credit", amount)),
      ]),
    );

    const result = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "smoke-test-hash",
      transaction,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.postings).toHaveLength(2);
    expect(result.value.balances.get(normalAccountId)?.equals(amount)).toBe(true);
    expect(result.value.balances.get(externalAccountId)?.equals(amount.negate())).toBe(true);

    const [normalRow] = await database.db
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.id, normalAccountId));
    const [externalRow] = await database.db
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.id, externalAccountId));
    expect(normalRow?.balance).toBe(10000n);
    expect(externalRow?.balance).toBe(-10000n);

    const transactionRows = await database.db
      .select()
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.orgId, orgId));
    expect(transactionRows).toHaveLength(1);

    const postingRows = await database.db
      .select()
      .from(ledgerPosting)
      .where(eq(ledgerPosting.orgId, orgId));
    expect(postingRows).toHaveLength(2);

    const auditRows = await database.db
      .select()
      .from(ledgerAuditEntry)
      .where(eq(ledgerAuditEntry.orgId, orgId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.outcome).toBe("posted");
  });

  it("rejects an insufficient-funds transfer, writes zero postings, and records exactly one rejection", async () => {
    const database = getDatabase();
    const { orgId, actorId } = await seedTenant(database);
    const sourceAccountId = await seedAccount(database, orgId, "normal", "Empty Source");
    const destinationAccountId = await seedAccount(database, orgId, "normal", "Destination");

    const amount = unwrap(Money.parse("50.00", "USD"));
    const transaction = unwrap(
      Transaction.create([
        unwrap(createPosting(destinationAccountId, "debit", amount)),
        unwrap(createPosting(sourceAccountId, "credit", amount)),
      ]),
    );

    const result = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "smoke-test-hash",
      transaction,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe("InsufficientFunds");

    const [sourceRow] = await database.db
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.id, sourceAccountId));
    const [destinationRow] = await database.db
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.id, destinationAccountId));
    expect(sourceRow?.balance).toBe(0n);
    expect(destinationRow?.balance).toBe(0n);

    const transactionRows = await database.db
      .select()
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.orgId, orgId));
    expect(transactionRows).toHaveLength(0);

    const postingRows = await database.db
      .select()
      .from(ledgerPosting)
      .where(eq(ledgerPosting.orgId, orgId));
    expect(postingRows).toHaveLength(0);

    const auditRows = await database.db
      .select()
      .from(ledgerAuditEntry)
      .where(eq(ledgerAuditEntry.orgId, orgId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.outcome).toBe("rejected");
    expect(auditRows[0]?.reason).toBe("insufficient_funds");
  });
});
