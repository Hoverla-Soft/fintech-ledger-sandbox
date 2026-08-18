import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPosting, Transaction } from "@fintech-ledger-sandbox/core";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { postTransaction } from "../posting/post-transaction";
import { ledgerAccount } from "../schema/ledger";
import { withOrgScope } from "../tenancy";
import {
  buildTransfer,
  getRootCauseMessage,
  money,
  seedAccount,
  seedTenant,
  unwrap,
} from "../test/fixtures";
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
        expect(Object.keys(crossOrgResult.error).sort()).toEqual(
          Object.keys(missingResult.error).sort(),
        );
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

      const crossOrgResult = await getTransactionById(
        database.db,
        orgAId,
        posted.value.transactionId,
      );
      const missingResult = await getTransactionById(database.db, orgAId, randomUUID());

      expect(crossOrgResult.ok).toBe(false);
      expect(missingResult.ok).toBe(false);
      if (!crossOrgResult.ok && !missingResult.ok) {
        expect(crossOrgResult.error.kind).toBe("TransactionNotFound");
        expect(missingResult.error.kind).toBe("TransactionNotFound");
        expect(Object.keys(crossOrgResult.error).sort()).toEqual(
          Object.keys(missingResult.error).sort(),
        );
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
      expect(reconciliation.map((row) => row.accountId).sort()).toEqual(
        [orgAFunding, orgANormal].sort(),
      );
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

      expect((await listAuditEntries(database.db, orgAId)).items).toEqual([]);
      expect((await listRejections(database.db, orgAId)).items).toEqual([]);

      const orgBAudit = await listAuditEntries(database.db, orgBId);
      expect(orgBAudit.items).toHaveLength(2);
      const orgBRejections = await listRejections(database.db, orgBId);
      expect(orgBRejections.items).toHaveLength(1);
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
      expect(orgARejections.items).toHaveLength(1);
      expect(orgARejections.items[0]?.reason).toBe("account_not_found");
      const orgBRejections = await listRejections(database.db, orgBId);
      expect(orgBRejections.items).toHaveLength(0);
    });
  });

  describe("boundary: an org with no activity", () => {
    it("a brand-new org with no accounts or transactions sees empty lists everywhere, not an error", async () => {
      const { orgId } = await seedTenant(database.db, "Empty");

      expect(await listAccounts(database.db, orgId)).toEqual([]);
      expect((await listTransactions(database.db, { orgId })).items).toEqual([]);
      expect((await listAuditEntries(database.db, orgId)).items).toEqual([]);
      expect((await listRejections(database.db, orgId)).items).toEqual([]);
      expect(await reconcileAccounts(database.db, orgId)).toEqual([]);
    });
  });
  /**
   * Every test above proves the *repositories* filter correctly. These prove
   * the database would refuse even if they did not — the half of invariant #5
   * that `docs/open-questions.md` #30 left open until migration 0008.
   *
   * Each one deliberately issues SQL with **no** `org_id` predicate at all.
   * That is the only way to distinguish "the query filtered" from "the policy
   * filtered", and a suite that never asks the unfiltered question cannot tell
   * whether row-level security is switched on or quietly inert.
   */
  describe("row-level security (open question #30)", () => {
    /** Reads every `ledger_account` row the caller is permitted to see, with no predicate whatsoever. */
    const allAccountNames = async (client: {
      select: (typeof database.db)["select"];
    }): Promise<string[]> => {
      const rows = await client.select({ name: ledgerAccount.name }).from(ledgerAccount);
      return rows.map((row) => row.name).sort();
    };

    it("an unfiltered read inside a scope returns only that org's rows", async () => {
      const { orgId: orgAId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId } = await seedTenant(database.db, "OrgB");
      await seedAccount(database.db, orgAId, "normal", "A-only");
      await seedAccount(database.db, orgBId, "normal", "B-only");

      // The control: as the owner, outside any scope, both rows are visible —
      // so the assertion below is about the policy, not about the fixtures.
      expect(await allAccountNames(database.db)).toEqual(["A-only", "B-only"]);

      expect(await withOrgScope(database.db, orgAId, allAccountNames)).toEqual(["A-only"]);
      expect(await withOrgScope(database.db, orgBId, allAccountNames)).toEqual(["B-only"]);
    });

    it("runs as the unprivileged role inside the scope and reverts after it", async () => {
      const { orgId } = await seedTenant(database.db, "Role");

      const inside = await withOrgScope(database.db, orgId, async (scoped) => {
        const result = await scoped.execute(sql`SELECT current_user AS role`);
        return (result.rows[0] as { role: string }).role;
      });
      expect(inside).toBe("ledger_app");

      // `SET LOCAL` reverts at COMMIT, so the pooled connection is not left
      // switched — the next request must not inherit this one's role.
      const after = await database.db.execute(sql`SELECT current_user AS role`);
      expect((after.rows[0] as { role: string }).role).not.toBe("ledger_app");
    });

    it("refuses to write a row belonging to another org", async () => {
      const { orgId: orgAId } = await seedTenant(database.db, "OrgA");
      const { orgId: orgBId } = await seedTenant(database.db, "OrgB");

      const smuggle = withOrgScope(database.db, orgAId, (scoped) =>
        scoped.insert(ledgerAccount).values({
          id: randomUUID(),
          orgId: orgBId,
          name: "Smuggled",
          currency: "USD",
          type: "normal",
        }),
      );

      // Asserted on the root cause, not on `DrizzleQueryError.message`, which
      // is only the echoed SQL — the policy violation lives on `.cause`.
      await expect(smuggle).rejects.toThrow();
      const cause = await smuggle.catch((error: unknown) => getRootCauseMessage(error));
      expect(cause).toMatch(/row-level security/i);

      expect(await allAccountNames(database.db)).toEqual([]);
    });

    it("sees nothing at all when the role is active but no org is set", async () => {
      const { orgId } = await seedTenant(database.db, "Unset");
      await seedAccount(database.db, orgId, "normal", "Hidden");

      // `current_setting(..., true)` is NULL when unset, and `org_id = NULL` is
      // NULL rather than true — so an unscoped query as `ledger_app` matches no
      // rows. Failing closed is the whole point: a caller that forgets to scope
      // gets nothing, not everyone's data.
      const visible = await database.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('role', 'ledger_app', true)`);
        return allAccountNames(tx as unknown as typeof database.db);
      });

      expect(visible).toEqual([]);
    });

    it("re-applies migration 0008 without error", async () => {
      // The role and its grant are cluster-wide, not database-scoped, so a
      // second database in the same cluster meets both already created. Both
      // guards in 0008 exist for that case; this is what proves they work,
      // since drizzle's migrator would never re-run the file on its own.
      const migration = await readFile(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../drizzle/0008_row_level_tenancy.sql",
        ),
        "utf8",
      );

      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim() !== "") {
          await database.db.execute(sql.raw(statement));
        }
      }

      const { orgId } = await seedTenant(database.db, "Reapplied");
      await seedAccount(database.db, orgId, "normal", "Still isolated");
      expect(await withOrgScope(database.db, orgId, allAccountNames)).toEqual(["Still isolated"]);
    });

    it("still commits the work when the scoped callback throws", async () => {
      const { orgId } = await seedTenant(database.db, "Commit");

      // `postTransaction` writes its rejection audit *after* rolling back, and
      // the API handler then throws. If `withOrgScope` rolled back on a throw,
      // that audit row — and this account — would vanish with it.
      await expect(
        withOrgScope(database.db, orgId, async (scoped) => {
          await scoped
            .insert(ledgerAccount)
            .values({ id: randomUUID(), orgId, name: "Survivor", currency: "USD", type: "normal" });
          throw new Error("handler failed after a durable write");
        }),
      ).rejects.toThrow("handler failed after a durable write");

      expect(await allAccountNames(database.db)).toEqual(["Survivor"]);
    });
  });
});
