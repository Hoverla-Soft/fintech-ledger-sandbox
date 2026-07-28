import { randomUUID } from "node:crypto";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import {
  buildTransfer,
  clientFor,
  postTransfer,
  type SeededTenant,
  seedAccount,
  seedTenant,
  sessionFor,
} from "../test/fixtures";

/**
 * The wire contract of the read surface: what the shapes actually look like
 * once they have crossed the boundary. Tenant scoping is covered separately
 * in `tenant-isolation.test.ts`; this file is about serialization and paging.
 */

let db: Db;
let reset: () => Promise<void>;
let tenant: SeededTenant;
let fundingId: string;
let walletId: string;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  tenant = await seedTenant(db, "Reads");
  fundingId = await seedAccount(db, tenant.orgId, "external", "Funding");
  walletId = await seedAccount(db, tenant.orgId, "normal", "Wallet");
});

function client() {
  return clientFor(db, sessionFor(tenant));
}

describe("money serialization", () => {
  it("encodes balances as decimal strings, never JSON numbers", async () => {
    await postTransfer(db, tenant, fundingId, walletId, "100.00");

    const wallet = await client().accounts.get({ accountId: walletId });

    expect(wallet.balance).toEqual({ amount: "100.00", currency: "USD" });
    expect(typeof wallet.balance.amount).toBe("string");
  });

  it("encodes the external account's negative balance correctly", async () => {
    // The funding account is credited, so it legitimately goes negative —
    // `external` accounts may, `normal` accounts may not (invariant #6).
    await postTransfer(db, tenant, fundingId, walletId, "100.00");

    const funding = await client().accounts.get({ accountId: fundingId });
    expect(funding.balance.amount).toBe("-100.00");
  });

  it("encodes posting amounts as decimal strings", async () => {
    const transactionId = await postTransfer(db, tenant, fundingId, walletId, "42.50");

    const transaction = await client().transactions.get({ transactionId });

    for (const posting of transaction.postings) {
      expect(typeof posting.amount.amount).toBe("string");
      expect(posting.amount.amount).toBe("42.50");
    }
  });

  it("survives JSON round-tripping — no bigint reaches the serializer", async () => {
    // ADR 0002's downstream obligation: `JSON.stringify` throws outright on a
    // bigint, so this would fail loudly rather than subtly if a raw
    // `minorUnits` ever leaked into a response.
    await postTransfer(db, tenant, fundingId, walletId, "1.00");
    const response = await client().accounts.list({});

    expect(() => JSON.stringify(response)).not.toThrow();
  });
});

describe("timestamp serialization", () => {
  it("encodes timestamps as ISO-8601 strings", async () => {
    const { accounts } = await client().accounts.list({});
    const account = accounts[0];

    expect(account).toBeDefined();
    expect(typeof account?.createdAt).toBe("string");
    expect(account?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("transactions.list pagination", () => {
  beforeEach(async () => {
    for (let index = 0; index < 5; index += 1) {
      await postTransfer(db, tenant, fundingId, walletId, "1.00");
    }
  });

  it("returns a cursor when more rows remain, and null on the last page", async () => {
    const firstPage = await client().transactions.list({ limit: 2 });

    expect(firstPage.transactions).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const lastPage = await client().transactions.list({ limit: 100 });
    expect(lastPage.transactions).toHaveLength(5);
    expect(lastPage.nextCursor).toBeNull();
  });

  it("walks every row exactly once across pages", async () => {
    // The property that actually matters about a cursor: no duplicates and
    // nothing skipped, even when rows share a `created_at`.
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const result = await client().transactions.list({ limit: 2, cursor });
      seen.push(...result.transactions.map((transaction) => transaction.id));

      if (result.nextCursor === null) {
        break;
      }
      cursor = result.nextCursor;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("rejects a malformed cursor as 400 rather than returning an empty page", async () => {
    await expect(client().transactions.list({ cursor: "not-a-real-cursor" })).rejects.toMatchObject(
      {
        status: 400,
        code: "BAD_REQUEST",
      },
    );
  });

  it("rejects an out-of-range limit at the contract boundary", async () => {
    await expect(client().transactions.list({ limit: 10_000 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(client().transactions.list({ limit: 0 })).rejects.toMatchObject({ status: 400 });
  });
});

describe("reconciliation.verify", () => {
  it("reports a freshly seeded org as reconciled", async () => {
    const result = await client().reconciliation.verify({});

    expect(result.accounts).toHaveLength(2);
    expect(result.allReconciled).toBe(true);
  });

  it("reports recorded and computed balances that agree after real postings", async () => {
    await postTransfer(db, tenant, fundingId, walletId, "75.25");

    const result = await client().reconciliation.verify({});
    const wallet = result.accounts.find((account) => account.accountId === walletId);

    expect(wallet?.recordedBalance).toEqual({ amount: "75.25", currency: "USD" });
    expect(wallet?.computedBalance).toEqual({ amount: "75.25", currency: "USD" });
    expect(wallet?.reconciled).toBe(true);
    expect(result.allReconciled).toBe(true);
  });
});

describe("audit", () => {
  it("records a posted transfer in the audit log", async () => {
    const transactionId = await postTransfer(db, tenant, fundingId, walletId, "10.00");

    const { entries } = await client().audit.list({});
    const entry = entries.find((candidate) => candidate.transactionId === transactionId);

    expect(entry).toBeDefined();
    expect(entry?.outcome).toBe("posted");
    expect(entry?.actorUserId).toBe(tenant.userId);
  });

  it("surfaces an insufficient-funds rejection through audit.rejections", async () => {
    // Exercises `ledger.md`'s "every rejection is recorded" requirement from
    // the read side: the failed attempt writes no postings, but the rejection
    // itself must be durable (ADR 0003's separate-transaction design).
    await postTransfer(db, tenant, fundingId, walletId, "50.00");

    // Overdraw the `normal` wallet, which invariant #6 forbids. The write
    // path rejects it and records the rejection in its own transaction.
    const overdraw = await postTransaction(db, {
      orgId: tenant.orgId,
      actorId: tenant.userId,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      transaction: buildTransfer(walletId, fundingId, "999.00"),
    });

    expect(overdraw.ok).toBe(false);

    const { entries } = await client().audit.rejections({});
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.outcome === "rejected")).toBe(true);
  });

  it("returns an empty list for an org with no rejections", async () => {
    await expect(client().audit.rejections({})).resolves.toEqual({ entries: [] });
  });
});
