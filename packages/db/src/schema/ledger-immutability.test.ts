import { randomUUID } from "node:crypto";

import { reverse } from "@fintech-ledger-sandbox/core";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { getTransactionById } from "../repositories/transactions";
import { postTransaction } from "../posting/post-transaction";
import { buildTransfer, getRootCauseMessage, seedAccount, seedTenant } from "../test/fixtures";
import { connectTestDatabase } from "../test/setup";
import { ledgerPosting } from "./ledger";

/**
 * Invariant #8 (docs/product/requirements/ledger.md): "postings are
 * append-only; corrections are reversing transactions." The `UPDATE`/
 * `DELETE` trigger is exercised by the existing `TRUNCATE` guard already
 * documented in `drizzle/0002_ledger_posting_immutability_trigger.sql`;
 * this file additionally proves `TRUNCATE ledger_posting` itself raises —
 * a gap noted in review, since `TRUNCATE` never fires row-level triggers in
 * Postgres and needs its own statement-level trigger — and that the only
 * sanctioned correction path (a reversing transaction linked via
 * `reverses_transaction_id`) actually works without mutating the original
 * postings.
 */
describe("ledger_posting immutability (invariant #8)", () => {
  let database: ReturnType<typeof connectTestDatabase>;

  beforeAll(() => {
    database = connectTestDatabase(inject("dbTestConnectionString"));
  });

  beforeEach(async () => {
    await database.reset();
  });

  async function seedOnePosting() {
    const { orgId, actorId } = await seedTenant(database.db);
    const funding = await seedAccount(database.db, orgId, "external", "Funding");
    const destination = await seedAccount(database.db, orgId, "normal", "Destination");
    const posted = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "seed-posting",
      transaction: buildTransfer(funding, destination, "42.00"),
    });
    if (!posted.ok) {
      throw new Error(`fixture setup failed: ${JSON.stringify(posted.error)}`);
    }
    const [postingRow] = posted.value.postings;
    if (postingRow === undefined) {
      throw new Error("fixture setup produced no postings");
    }
    return { orgId, actorId, funding, destination, transactionId: posted.value.transactionId, postingRow };
  }

  it("a direct UPDATE on ledger_posting is rejected by the database, leaving the row unchanged", async () => {
    const { postingRow } = await seedOnePosting();

    let caught: unknown;
    try {
      await database.db.execute(sql`UPDATE ledger_posting SET amount = 999999 WHERE id = ${postingRow.id}`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(getRootCauseMessage(caught)).toContain("append-only");

    const [rowAfter] = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.id, postingRow.id));
    expect(rowAfter?.amount).toBe(postingRow.amount.minorUnits);
  });

  it("a direct DELETE on ledger_posting is rejected by the database, leaving the row in place", async () => {
    const { postingRow } = await seedOnePosting();

    let caught: unknown;
    try {
      await database.db.execute(sql`DELETE FROM ledger_posting WHERE id = ${postingRow.id}`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(getRootCauseMessage(caught)).toContain("append-only");

    const [rowAfter] = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.id, postingRow.id));
    expect(rowAfter).toBeDefined();
  });

  it("TRUNCATE ledger_posting is rejected by the database — TRUNCATE never fires row-level triggers, so this needs its own statement-level trigger", async () => {
    const { orgId } = await seedOnePosting();

    let caught: unknown;
    try {
      await database.db.execute(sql`TRUNCATE TABLE ledger_posting`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(getRootCauseMessage(caught)).toContain("append-only");

    const rowsAfter = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.orgId, orgId));
    expect(rowsAfter.length).toBeGreaterThan(0);
  });

  it("correction is only via a reversing transaction linked by reverses_transaction_id, and never mutates the original posting rows", async () => {
    const { orgId, actorId, funding, destination, transactionId } = await seedOnePosting();

    const originalPostingsBefore = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.transactionId, transactionId));
    expect(originalPostingsBefore).toHaveLength(2);

    const originalDomainTransaction = buildTransfer(funding, destination, "42.00");
    const reversalTransaction = reverse(originalDomainTransaction);

    const reversalResult = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "reversal",
      transaction: reversalTransaction,
      reversesTransactionId: transactionId,
    });
    expect(reversalResult.ok).toBe(true);
    if (!reversalResult.ok) {
      return;
    }

    const reversalRow = await getTransactionById(database.db, orgId, reversalResult.value.transactionId);
    expect(reversalRow.ok).toBe(true);
    if (reversalRow.ok) {
      expect(reversalRow.value.reversesTransactionId).toBe(transactionId);
    }

    // The original posting rows are byte-identical to before the reversal —
    // correction is additive, never a mutation of history.
    const originalPostingsAfter = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.transactionId, transactionId));
    expect(originalPostingsAfter).toEqual(originalPostingsBefore);
  });
});
