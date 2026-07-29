import { randomUUID } from "node:crypto";

import { createPosting, reverse, Transaction } from "@fintech-ledger-sandbox/core";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { getAccountById } from "../repositories/accounts";
import { listRejections } from "../repositories/audit";
import { reconcileAccounts } from "../repositories/reconciliation";
import { getTransactionById } from "../repositories/transactions";
import { buildTransfer, money, seedAccount, seedTenant, unwrap } from "../test/fixtures";
import { connectTestDatabase } from "../test/setup";
import { postTransaction } from "./post-transaction";

/**
 * The four `docs/product/requirements/ledger.md` acceptance scenarios, as
 * integration fixtures. Each ends with a clean `reconcileAccounts` check —
 * this is the primary coverage location for invariant #2 ("balances
 * reconcile") across realistic multi-leg and rejection/reversal shapes,
 * not just the simple 2-leg transfer the smoke test already covers.
 */
describe("ledger.md acceptance scenarios", () => {
  let database: ReturnType<typeof connectTestDatabase>;

  beforeAll(() => {
    database = connectTestDatabase(inject("dbTestConnectionString"));
  });

  beforeEach(async () => {
    await database.reset();
  });

  /** Fetches an account and asserts its balance, failing loudly (rather than a confusing boolean mismatch) if the lookup itself did not succeed. */
  async function expectBalance(
    orgId: string,
    accountId: string,
    expectedMinorUnits: bigint,
  ): Promise<void> {
    const result = await getAccountById(database.db, orgId, accountId);
    if (!result.ok) {
      throw new Error(
        `expected account "${accountId}" to be found, got: ${JSON.stringify(result.error)}`,
      );
    }
    expect(result.value.balance).toBe(expectedMinorUnits);
  }

  it("scenario 1 — payroll run: one funding account pays many employee accounts, and reconciliation is clean", async () => {
    const { orgId, actorId } = await seedTenant(database.db, "Payroll");
    const funding = await seedAccount(database.db, orgId, "external", "Payroll Funding");
    const alice = await seedAccount(database.db, orgId, "normal", "Alice");
    const bob = await seedAccount(database.db, orgId, "normal", "Bob");
    const carol = await seedAccount(database.db, orgId, "normal", "Carol");

    // One balanced transaction: funding credited once for the total,
    // each employee debited their own pay.
    const payroll = unwrap(
      Transaction.create([
        unwrap(createPosting(alice, "debit", money("1500.00"))),
        unwrap(createPosting(bob, "debit", money("2200.50"))),
        unwrap(createPosting(carol, "debit", money("999.99"))),
        unwrap(createPosting(funding, "credit", money("4700.49"))),
      ]),
    );

    const result = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "payroll-run",
      transaction: payroll,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.postings).toHaveLength(4);

    await expectBalance(orgId, alice, 150000n);
    await expectBalance(orgId, bob, 220050n);
    await expectBalance(orgId, carol, 99999n);
    await expectBalance(orgId, funding, -470049n);

    const reconciliation = await reconcileAccounts(database.db, orgId);
    expect(reconciliation).toHaveLength(4);
    for (const row of reconciliation) {
      expect(row.reconciled).toBe(true);
    }
  });

  it("scenario 2 — marketplace payout with fees: an N-leg transaction with a fee leg nets to the escrow debit, and reconciliation is clean", async () => {
    const { orgId, actorId } = await seedTenant(database.db, "Marketplace");
    const escrow = await seedAccount(database.db, orgId, "external", "Marketplace Escrow");
    const seller = await seedAccount(database.db, orgId, "normal", "Seller");
    const platformFees = await seedAccount(database.db, orgId, "normal", "Platform Fees");

    // Gross $100.00 sale: seller nets $95.00, the platform keeps a $5.00
    // fee leg, escrow (external) is credited the full gross amount.
    const payout = unwrap(
      Transaction.create([
        unwrap(createPosting(seller, "debit", money("95.00"))),
        unwrap(createPosting(platformFees, "debit", money("5.00"))),
        unwrap(createPosting(escrow, "credit", money("100.00"))),
      ]),
    );

    const result = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "marketplace-payout",
      transaction: payout,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.postings).toHaveLength(3);

    await expectBalance(orgId, seller, 9500n);
    await expectBalance(orgId, platformFees, 500n);
    await expectBalance(orgId, escrow, -10000n);

    const reconciliation = await reconcileAccounts(database.db, orgId);
    expect(reconciliation).toHaveLength(3);
    for (const row of reconciliation) {
      expect(row.reconciled).toBe(true);
    }
  });

  it("scenario 3 — insufficient-funds rejection leaves balances untouched and reconciliation clean", async () => {
    const { orgId, actorId } = await seedTenant(database.db, "Rejection");
    const source = await seedAccount(database.db, orgId, "normal", "Empty Source");
    const destination = await seedAccount(database.db, orgId, "normal", "Destination");

    const result = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "insufficient-funds-scenario",
      transaction: buildTransfer(source, destination, "50.00"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("InsufficientFunds");
    }

    await expectBalance(orgId, source, 0n);
    await expectBalance(orgId, destination, 0n);

    const rejections = await listRejections(database.db, orgId);
    expect(rejections.items).toHaveLength(1);
    expect(rejections.items[0]?.reason).toBe("insufficient_funds");

    const reconciliation = await reconcileAccounts(database.db, orgId);
    expect(reconciliation).toHaveLength(2);
    for (const row of reconciliation) {
      expect(row.reconciled).toBe(true);
    }
  });

  it("scenario 4 — reversal restores prior balances via a linked reversing transaction, and reconciliation is clean", async () => {
    const { orgId, actorId } = await seedTenant(database.db, "Reversal");
    const funding = await seedAccount(database.db, orgId, "external", "Funding");
    const normal = await seedAccount(database.db, orgId, "normal", "Wallet");

    const originalTransaction = buildTransfer(funding, normal, "250.00");
    const originalResult = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "reversal-original",
      transaction: originalTransaction,
    });
    expect(originalResult.ok).toBe(true);
    if (!originalResult.ok) {
      return;
    }

    await expectBalance(orgId, funding, -25000n);
    await expectBalance(orgId, normal, 25000n);

    const reversalResult = await postTransaction(database.db, {
      orgId,
      actorId,
      idempotencyKey: randomUUID(),
      requestHash: "reversal-correction",
      transaction: reverse(originalTransaction),
      reversesTransactionId: originalResult.value.transactionId,
    });
    expect(reversalResult.ok).toBe(true);
    if (!reversalResult.ok) {
      return;
    }

    const reversalTransactionRow = await getTransactionById(
      database.db,
      orgId,
      reversalResult.value.transactionId,
    );
    expect(reversalTransactionRow.ok).toBe(true);
    if (reversalTransactionRow.ok) {
      expect(reversalTransactionRow.value.reversesTransactionId).toBe(
        originalResult.value.transactionId,
      );
    }

    await expectBalance(orgId, funding, 0n);
    await expectBalance(orgId, normal, 0n);

    const reconciliation = await reconcileAccounts(database.db, orgId);
    expect(reconciliation).toHaveLength(2);
    for (const row of reconciliation) {
      expect(row.reconciled).toBe(true);
    }
  });
});
