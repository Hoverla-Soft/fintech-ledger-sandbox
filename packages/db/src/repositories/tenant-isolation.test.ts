import { randomUUID } from "node:crypto";

import { createPosting, Transaction } from "@fintech-ledger-sandbox/core";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { postTransaction } from "../posting/post-transaction";
import { buildTransfer, money, seedAccount, seedTenant, unwrap } from "../test/fixtures";
import { connectTestDatabase } from "../test/setup";
import { getAccountById, listAccounts } from "./accounts";
import { listAuditEntries, listRejections } from "./audit";
import { reconcileAccounts } from "./reconciliation";
import { getTransactionById, listTransactions } from "./transactions";

/**
 * Invariant #5 (docs/product/requirements/ledger.md line 56 / this task's
 * design note on `lockAccounts`): "no read or write ever crosses an org
 * boundary," and a cross-org id must be indistinguishable from a genuinely
 * missing one. Covers every read repository (accounts, transactions +
 * postings, reconciliation, audit/rejections) plus `postTransaction`'s own
 * cross-org account rejection, each with both a positive control (an org
 * reading its own data) and the cross-org negative case.
 */
describe("tenant isolation (invariant #5)", () => {
  let database: ReturnType<typeof connectTestDatabase>;

  beforeAll(() => {
    database = connectTestDatabase(inject("dbTestConnectionString"));
  });

  beforeEach(async () => {
    await database.reset();
  });

  describe("accounts", () => {
    it("getAccountById: org A can read its own account (happy path)", async () => {
      const { orgId } = await seedTenant(database.db, "OrgA");
      const accountId = await seedAccount(database.db, orgId, "normal", "Alice");

      const result = await getAccountById(database.db, orgId, accountId);
      expect(result.ok).toBe(true);
    });

    it("getAccountById: org B's account id is indistinguishable from a nonexistent id when queried as org A", async () => {
      const { orgId: orgAId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId } = await seedTenant(database.db, "OrgB");
      const orgBAccountId = await seedAccount(database.db, orgBId, "normal", "Bob");

      const crossOrgResult = await getAccountById(database.db, orgAId, orgBAccountId);
      const missingResult = await getAccountById(database.db, orgAId, randomUUID());

      expect(crossOrgResult.ok).toBe(false);
      expect(missingResult.ok).toBe(false);
      if (!crossOrgResult.ok && !missingResult.ok) {
        expect(crossOrgResult.error.kind).toBe("AccountNotFound");
        expect(missingResult.error.kind).toBe("AccountNotFound");
        // Same error shape for a real-but-foreign id and a genuinely
        // missing one — only the echoed input id differs, never any
        // indication one exists and the other doesn't.
        expect(Object.keys(crossOrgResult.error).sort()).toEqual(Object.keys(missingResult.error).sort());
      }
    });

    it("listAccounts: org A never sees org B's accounts, even when both use the identical account name", async () => {
      const { orgId: orgAId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId } = await seedTenant(database.db, "OrgB");
      const orgAAccountId = await seedAccount(database.db, orgAId, "normal", "Shared Name");
      await seedAccount(database.db, orgBId, "normal", "Shared Name");

      const rows = await listAccounts(database.db, orgAId);
      expect(rows.map((row) => row.id)).toEqual([orgAAccountId]);
    });
  });

  describe("transactions and postings", () => {
    it("getTransactionById: org B's transaction id (and its postings) is indistinguishable from a nonexistent id when queried as org A", async () => {
      const { orgId: orgAId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId, actorId: orgBActorId } = await seedTenant(database.db, "OrgB");
      const orgBFunding = await seedAccount(database.db, orgBId, "external", "Funding");
      const orgBDestination = await seedAccount(database.db, orgBId, "normal", "Destination");

      const posted = await postTransaction(database.db, {
        orgId: orgBId,
        actorId: orgBActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-b-transfer",
        transaction: buildTransfer(orgBFunding, orgBDestination, "12.00"),
      });
      expect(posted.ok).toBe(true);
      if (!posted.ok) {
        return;
      }

      const crossOrgResult = await getTransactionById(database.db, orgAId, posted.value.transactionId);
      const missingResult = await getTransactionById(database.db, orgAId, randomUUID());

      expect(crossOrgResult.ok).toBe(false);
      expect(missingResult.ok).toBe(false);
      if (!crossOrgResult.ok && !missingResult.ok) {
        expect(crossOrgResult.error.kind).toBe("TransactionNotFound");
        expect(missingResult.error.kind).toBe("TransactionNotFound");
        expect(Object.keys(crossOrgResult.error).sort()).toEqual(Object.keys(missingResult.error).sort());
      }
    });

    it("listTransactions: org A's history never includes org B's transactions", async () => {
      const { orgId: orgAId, actorId: orgAActorId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId, actorId: orgBActorId } = await seedTenant(database.db, "OrgB");
      const orgAFunding = await seedAccount(database.db, orgAId, "external", "Funding");
      const orgADestination = await seedAccount(database.db, orgAId, "normal", "Destination");
      const orgBFunding = await seedAccount(database.db, orgBId, "external", "Funding");
      const orgBDestination = await seedAccount(database.db, orgBId, "normal", "Destination");

      const orgAPosted = await postTransaction(database.db, {
        orgId: orgAId,
        actorId: orgAActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-a-transfer",
        transaction: buildTransfer(orgAFunding, orgADestination, "5.00"),
      });
      const orgBPosted = await postTransaction(database.db, {
        orgId: orgBId,
        actorId: orgBActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-b-transfer",
        transaction: buildTransfer(orgBFunding, orgBDestination, "5.00"),
      });
      expect(orgAPosted.ok).toBe(true);
      expect(orgBPosted.ok).toBe(true);
      if (!orgAPosted.ok || !orgBPosted.ok) {
        return;
      }

      const page = await listTransactions(database.db, { orgId: orgAId });
      expect(page.items.map((item) => item.id)).toEqual([orgAPosted.value.transactionId]);
      expect(page.items.map((item) => item.id)).not.toContain(orgBPosted.value.transactionId);
    });
  });

  describe("reconciliation", () => {
    it("reconcileAccounts: org A's reconciliation never includes org B's accounts or postings", async () => {
      const { orgId: orgAId, actorId: orgAActorId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId, actorId: orgBActorId } = await seedTenant(database.db, "OrgB");
      const orgAFunding = await seedAccount(database.db, orgAId, "external", "Funding");
      const orgANormal = await seedAccount(database.db, orgAId, "normal", "Wallet");
      const orgBFunding = await seedAccount(database.db, orgBId, "external", "Funding");
      const orgBNormal = await seedAccount(database.db, orgBId, "normal", "Wallet");

      await postTransaction(database.db, {
        orgId: orgAId,
        actorId: orgAActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-a",
        transaction: buildTransfer(orgAFunding, orgANormal, "7.00"),
      });
      await postTransaction(database.db, {
        orgId: orgBId,
        actorId: orgBActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-b",
        transaction: buildTransfer(orgBFunding, orgBNormal, "999.00"),
      });

      const reconciliation = await reconcileAccounts(database.db, orgAId);
      expect(reconciliation.map((row) => row.accountId).sort()).toEqual([orgAFunding, orgANormal].sort());
      for (const row of reconciliation) {
        expect(row.reconciled).toBe(true);
      }
      expect(reconciliation.map((row) => row.accountId)).not.toContain(orgBFunding);
      expect(reconciliation.map((row) => row.accountId)).not.toContain(orgBNormal);
    });
  });

  describe("audit and rejections", () => {
    it("listAuditEntries and listRejections: org A never sees org B's audit entries", async () => {
      const { orgId: orgAId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId, actorId: orgBActorId } = await seedTenant(database.db, "OrgB");
      const orgBSource = await seedAccount(database.db, orgBId, "normal", "Empty Source");
      const orgBDestination = await seedAccount(database.db, orgBId, "normal", "Destination");

      // One posted and one rejected entry under org B only.
      const orgBFunding = await seedAccount(database.db, orgBId, "external", "Funding");
      await postTransaction(database.db, {
        orgId: orgBId,
        actorId: orgBActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-b-posted",
        transaction: buildTransfer(orgBFunding, orgBDestination, "3.00"),
      });
      await postTransaction(database.db, {
        orgId: orgBId,
        actorId: orgBActorId,
        idempotencyKey: randomUUID(),
        requestHash: "org-b-rejected",
        transaction: buildTransfer(orgBSource, orgBDestination, "3.00"),
      });

      expect(await listAuditEntries(database.db, orgAId)).toEqual([]);
      expect(await listRejections(database.db, orgAId)).toEqual([]);

      const orgBAudit = await listAuditEntries(database.db, orgBId);
      expect(orgBAudit).toHaveLength(2);
      const orgBRejections = await listRejections(database.db, orgBId);
      expect(orgBRejections).toHaveLength(1);
    });
  });

  describe("posting a transaction across org boundaries", () => {
    it("postTransaction: an account belonging to org B cannot be posted against from org A, and reports the same AccountNotFound as a genuinely missing account", async () => {
      const { orgId: orgAId, actorId: orgAActorId } = await seedTenant(database.db, "OrgA");
      const orgAFunding = await seedAccount(database.db, orgAId, "external", "Funding");
      const { orgId: orgBId } = await seedTenant(database.db, "OrgB");
      const orgBAccountId = await seedAccount(database.db, orgBId, "normal", "Foreign Target");

      const crossOrgTransaction = unwrap(
        Transaction.create([
          unwrap(createPosting(orgBAccountId, "debit", money("9.00"))),
          unwrap(createPosting(orgAFunding, "credit", money("9.00"))),
        ]),
      );

      const result = await postTransaction(database.db, {
        orgId: orgAId,
        actorId: orgAActorId,
        idempotencyKey: randomUUID(),
        requestHash: "cross-org-attempt",
        transaction: crossOrgTransaction,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("AccountNotFound");
        if (result.error.kind === "AccountNotFound") {
          expect(result.error.accountId).toBe(orgBAccountId);
        }
      }

      // Nothing posted under org A...
      const orgATransactions = await listTransactions(database.db, { orgId: orgAId });
      expect(orgATransactions.items).toHaveLength(0);
      // ...and org B's account balance is completely unaffected.
      const orgBAccountResult = await getAccountById(database.db, orgBId, orgBAccountId);
      expect(orgBAccountResult.ok).toBe(true);
      if (orgBAccountResult.ok) {
        expect(orgBAccountResult.value.balance).toBe(0n);
      }

      // The rejection is recorded under the *calling* org (A), never org B.
      const orgARejections = await listRejections(database.db, orgAId);
      expect(orgARejections).toHaveLength(1);
      expect(orgARejections[0]?.reason).toBe("account_not_found");
      const orgBRejections = await listRejections(database.db, orgBId);
      expect(orgBRejections).toHaveLength(0);
    });
  });

  describe("boundary: an org with no activity", () => {
    it("a brand-new org with no accounts or transactions sees empty lists everywhere, not an error", async () => {
      const { orgId } = await seedTenant(database.db, "Empty");

      expect(await listAccounts(database.db, orgId)).toEqual([]);
      expect((await listTransactions(database.db, { orgId })).items).toEqual([]);
      expect(await listAuditEntries(database.db, orgId)).toEqual([]);
      expect(await listRejections(database.db, orgId)).toEqual([]);
      expect(await reconcileAccounts(database.db, orgId)).toEqual([]);
    });
  });
});
