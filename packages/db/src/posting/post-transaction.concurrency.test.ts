import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { reconcileAccounts } from "../repositories/reconciliation";
import { ledgerAccount, ledgerPosting, ledgerTransaction } from "../schema/ledger";
import { buildTransfer, seedAccount, seedTenant } from "../test/fixtures";
import { connectTestDatabase } from "../test/setup";
import { postTransaction } from "./post-transaction";

/**
 * Invariant #4 (idempotency under concurrency) and invariant #6 (sufficient
 * funds under contention). Both sections fire genuinely concurrent
 * `postTransaction` calls via `Promise.all` against the SAME `Db` — never
 * sequential `await`s — over real, separate `pg.Pool` connections
 * (`createDb`'s default `pg.Pool` allows up to 10 concurrent clients, well
 * above the concurrency levels used here), so the race conditions these
 * tests exercise are real Postgres races, not simulated ones.
 */
describe("postTransaction under real concurrency", () => {
  let database: ReturnType<typeof connectTestDatabase>;

  beforeAll(() => {
    database = connectTestDatabase(inject("dbTestConnectionString"));
  });

  beforeEach(async () => {
    await database.reset();
  });

  describe("idempotency (invariant #4)", () => {
    it("N concurrent calls sharing one idempotency key and request hash produce exactly one transaction, and every caller receives the same transaction id", async () => {
      const { orgId, actorId } = await seedTenant(database.db);
      const funding = await seedAccount(database.db, orgId, "external", "Funding");
      const destination = await seedAccount(database.db, orgId, "normal", "Destination");
      const transaction = buildTransfer(funding, destination, "10.00");
      const idempotencyKey = randomUUID();
      const requestHash = "concurrent-shared-key";

      const CONCURRENCY = 6;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          postTransaction(database.db, { orgId, actorId, idempotencyKey, requestHash, transaction }),
        ),
      );

      for (const result of results) {
        expect(result.ok).toBe(true);
      }
      const transactionIds = new Set(results.map((result) => (result.ok ? result.value.transactionId : undefined)));
      expect(transactionIds.size).toBe(1);

      const transactionRows = await database.db.select().from(ledgerTransaction).where(eq(ledgerTransaction.orgId, orgId));
      expect(transactionRows).toHaveLength(1);

      const postingRows = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.orgId, orgId));
      expect(postingRows).toHaveLength(2);

      // Proves only ONE transfer applied despite `CONCURRENCY` callers —
      // 1000n (one $10.00 transfer), never 6 x 1000n.
      const [destinationRow] = await database.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, destination));
      expect(destinationRow?.balance).toBe(1000n);
    });

    it("a second, sequential call with the same key and the same request hash replays the original result without posting again", async () => {
      const { orgId, actorId } = await seedTenant(database.db);
      const funding = await seedAccount(database.db, orgId, "external", "Funding");
      const destination = await seedAccount(database.db, orgId, "normal", "Destination");
      const transaction = buildTransfer(funding, destination, "15.00");
      const idempotencyKey = randomUUID();
      const requestHash = "replay-hash";

      const first = await postTransaction(database.db, { orgId, actorId, idempotencyKey, requestHash, transaction });
      expect(first.ok).toBe(true);
      const second = await postTransaction(database.db, { orgId, actorId, idempotencyKey, requestHash, transaction });
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.value.transactionId).toBe(first.value.transactionId);
      }

      const transactionRows = await database.db.select().from(ledgerTransaction).where(eq(ledgerTransaction.orgId, orgId));
      expect(transactionRows).toHaveLength(1);
      const postingRows = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.orgId, orgId));
      expect(postingRows).toHaveLength(2);
    });

    it("a second, sequential call with the same key but a different request hash returns IdempotencyConflict and posts nothing new", async () => {
      const { orgId, actorId } = await seedTenant(database.db);
      const funding = await seedAccount(database.db, orgId, "external", "Funding");
      const destination = await seedAccount(database.db, orgId, "normal", "Destination");
      const idempotencyKey = randomUUID();

      const first = await postTransaction(database.db, {
        orgId,
        actorId,
        idempotencyKey,
        requestHash: "hash-A",
        transaction: buildTransfer(funding, destination, "20.00"),
      });
      expect(first.ok).toBe(true);

      const second = await postTransaction(database.db, {
        orgId,
        actorId,
        idempotencyKey,
        requestHash: "hash-B",
        transaction: buildTransfer(funding, destination, "999.00"),
      });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.kind).toBe("IdempotencyConflict");
        if (second.error.kind === "IdempotencyConflict") {
          expect(second.error.idempotencyKey).toBe(idempotencyKey);
        }
      }

      const transactionRows = await database.db.select().from(ledgerTransaction).where(eq(ledgerTransaction.orgId, orgId));
      expect(transactionRows).toHaveLength(1);
      const [destinationRow] = await database.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, destination));
      expect(destinationRow?.balance).toBe(2000n);
    });

    it("under real concurrency, a mix of matching- and mismatched-request-hash callers converges to exactly one posted transaction, with every loser either replaying it or getting IdempotencyConflict", async () => {
      const { orgId, actorId } = await seedTenant(database.db);
      const funding = await seedAccount(database.db, orgId, "external", "Funding");
      const destination = await seedAccount(database.db, orgId, "normal", "Destination");
      const idempotencyKey = randomUUID();
      const transferA = buildTransfer(funding, destination, "10.00");
      const transferB = buildTransfer(funding, destination, "25.00");

      // Which group's request hash ends up "the original" is a genuine
      // race (whichever caller's INSERT commits first), so the assertions
      // below are written to hold regardless of who wins — the invariant
      // under test is that the *count* of real posted transactions is
      // exactly one and every other caller is either a replay of it or an
      // explicit conflict, not which specific caller happened to win.
      const callers = [
        { requestHash: "hash-A", transaction: transferA },
        { requestHash: "hash-A", transaction: transferA },
        { requestHash: "hash-A", transaction: transferA },
        { requestHash: "hash-A", transaction: transferA },
        { requestHash: "hash-B", transaction: transferB },
      ];

      const results = await Promise.all(
        callers.map((caller) =>
          postTransaction(database.db, {
            orgId,
            actorId,
            idempotencyKey,
            requestHash: caller.requestHash,
            transaction: caller.transaction,
          }),
        ),
      );

      const okResults = results.filter((result) => result.ok);
      const errResults = results.filter((result): result is Extract<(typeof results)[number], { ok: false }> => !result.ok);

      expect(okResults.length).toBeGreaterThan(0);
      const transactionIds = new Set(okResults.map((result) => (result.ok ? result.value.transactionId : undefined)));
      expect(transactionIds.size).toBe(1);

      for (const errResult of errResults) {
        expect(errResult.error.kind).toBe("IdempotencyConflict");
        if (errResult.error.kind === "IdempotencyConflict") {
          expect(errResult.error.idempotencyKey).toBe(idempotencyKey);
        }
      }

      const transactionRows = await database.db.select().from(ledgerTransaction).where(eq(ledgerTransaction.orgId, orgId));
      expect(transactionRows).toHaveLength(1);
      const postingRows = await database.db.select().from(ledgerPosting).where(eq(ledgerPosting.orgId, orgId));
      expect(postingRows).toHaveLength(2);
    });
  });

  describe("sufficient funds under contention (invariant #6)", () => {
    it("concurrent withdrawals from one normal account never drive it negative; the external funding account may go negative", async () => {
      const { orgId, actorId } = await seedTenant(database.db);
      const funding = await seedAccount(database.db, orgId, "external", "Funding");
      const wallet = await seedAccount(database.db, orgId, "normal", "Wallet");

      const funded = await postTransaction(database.db, {
        orgId,
        actorId,
        idempotencyKey: randomUUID(),
        requestHash: "fund-wallet",
        transaction: buildTransfer(funding, wallet, "100.00"),
      });
      expect(funded.ok).toBe(true);

      // $100.00 starting balance, five concurrent $30.00 withdrawal
      // attempts: exactly 3 can succeed (90 <= 100), and the count is
      // deterministic regardless of which attempts happen to win the row
      // lock, since every attempt requests the identical amount.
      const ATTEMPTS = 5;
      const results = await Promise.all(
        Array.from({ length: ATTEMPTS }, () =>
          postTransaction(database.db, {
            orgId,
            actorId,
            idempotencyKey: randomUUID(),
            requestHash: "withdraw",
            transaction: buildTransfer(wallet, funding, "30.00"),
          }),
        ),
      );

      const succeeded = results.filter((result) => result.ok);
      const rejected = results.filter((result): result is Extract<(typeof results)[number], { ok: false }> => !result.ok);
      expect(succeeded).toHaveLength(3);
      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        expect(result.error.kind).toBe("InsufficientFunds");
      }

      const [walletRow] = await database.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, wallet));
      expect(walletRow?.balance).toBe(1000n); // $10.00 remains
      expect(walletRow !== undefined && walletRow.balance >= 0n).toBe(true);

      const [fundingRow] = await database.db.select().from(ledgerAccount).where(eq(ledgerAccount.id, funding));
      expect(fundingRow?.balance).toBe(-1000n); // -$10.00: external may go negative
      expect(fundingRow !== undefined && fundingRow.balance < 0n).toBe(true);

      const reconciliation = await reconcileAccounts(database.db, orgId);
      expect(reconciliation.length).toBeGreaterThan(0);
      for (const row of reconciliation) {
        expect(row.reconciled).toBe(true);
      }
    });
  });
});
