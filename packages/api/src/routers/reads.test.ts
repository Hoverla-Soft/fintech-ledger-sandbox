import { randomUUID } from "node:crypto";
import { createPosting, Transaction } from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import {
  buildTransfer,
  clientFor,
  money,
  postTransfer,
  type SeededTenant,
  seedAccount,
  seedTenant,
  sessionFor,
  unwrap,
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

describe("transactions.list filters", () => {
  it("filters by account, kind, and debit-total amount bounds in SQL", async () => {
    const otherWallet = await seedAccount(db, tenant.orgId, "normal", "Other wallet");
    const small = await postTransfer(db, tenant, fundingId, walletId, "10.00");
    const large = await postTransfer(db, tenant, fundingId, walletId, "50.00");
    await postTransfer(db, tenant, fundingId, otherWallet, "50.00");
    const reversal = await client().transactions.reverse({
      transactionId: small,
      idempotencyKey: randomUUID(),
    });

    const byAccount = await client().transactions.list({ accountId: walletId, limit: 50 });
    expect(byAccount.transactions.map((row) => row.id).sort()).toEqual(
      [small, large, reversal.id].sort(),
    );

    const reversals = await client().transactions.list({ kind: "reversals", limit: 50 });
    expect(reversals.transactions.map((row) => row.id)).toEqual([reversal.id]);

    const transfers = await client().transactions.list({ kind: "transfers", limit: 50 });
    expect(transfers.transactions.some((row) => row.id === reversal.id)).toBe(false);

    const mid = await client().transactions.list({
      accountId: walletId,
      minAmount: "20.00",
      maxAmount: "60.00",
      limit: 50,
    });
    // Reversal of 10.00 has debit total 10.00 — out of range. Large 50.00 stays.
    expect(mid.transactions.map((row) => row.id)).toEqual([large]);
  });

  it("keeps cursor pagination correct under a filter", async () => {
    for (let index = 0; index < 4; index += 1) {
      await postTransfer(db, tenant, fundingId, walletId, "1.00");
    }
    const other = await seedAccount(db, tenant.orgId, "normal", "Elsewhere");
    await postTransfer(db, tenant, fundingId, other, "1.00");

    const first = await client().transactions.list({ accountId: walletId, limit: 2 });
    expect(first.transactions).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await client().transactions.list({
      accountId: walletId,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.transactions).toHaveLength(2);
    const ids = [...first.transactions, ...second.transactions].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
    expect(
      ids.every((id) =>
        first.transactions.concat(second.transactions).some((row) => row.id === id),
      ),
    ).toBe(true);
    for (const row of [...first.transactions, ...second.transactions]) {
      expect(row.postings.some((posting) => posting.accountId === walletId)).toBe(true);
    }
  });
});

describe("transactions.list carries what moved (Phase 6b, open question #2)", () => {
  it("returns every posting on every row, so a history table can show amounts", async () => {
    // Before 6b this endpoint returned `transactionSchema`, which has no
    // amounts and no postings — the console could say a transfer happened but
    // not what moved. The N+1 objection on record was about the *client*
    // calling `transactions.get` per row; server-side this is one extra
    // batched `IN` query for the whole page.
    await postTransfer(db, tenant, fundingId, walletId, "12.34");

    const { transactions } = await client().transactions.list({});
    const [transaction] = transactions;

    expect(transaction?.postings).toHaveLength(2);
    expect(transaction?.postings.find((posting) => posting.accountId === walletId)).toMatchObject({
      direction: "debit",
      amount: { amount: "12.34", currency: "USD" },
    });
    expect(transaction?.postings.find((posting) => posting.accountId === fundingId)).toMatchObject({
      direction: "credit",
      amount: { amount: "12.34", currency: "USD" },
    });
  });

  it("keeps every leg of a transaction with more than two postings", async () => {
    // The reason no scalar `amount` field was added: a split has no single
    // amount. If a future change collapses postings into one number, this
    // fails.
    const secondWalletId = await seedAccount(db, tenant.orgId, "normal", "Wallet Two");
    const amount = money("10.00");
    const half = money("5.00");
    await postTransaction(db, {
      orgId: tenant.orgId,
      actorId: tenant.userId,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      transaction: unwrap(
        Transaction.create([
          unwrap(createPosting(walletId, "debit", half)),
          unwrap(createPosting(secondWalletId, "debit", half)),
          unwrap(createPosting(fundingId, "credit", amount)),
        ]),
      ),
    });

    const { transactions } = await client().transactions.list({});
    const split = transactions.find((candidate) => candidate.postings.length === 3);

    expect(split).toBeDefined();
    expect(split?.postings.filter((posting) => posting.direction === "debit")).toHaveLength(2);
  });

  it("issues a constant number of queries regardless of page size", async () => {
    // The property that makes D2 true. If someone reintroduces a per-row
    // lookup, query count grows with the page and this fails.
    for (let index = 0; index < 6; index += 1) {
      await postTransfer(db, tenant, fundingId, walletId, "1.00");
    }

    // Counted by wrapping the pool's own `query`, not by listening for a
    // `query` event — `pg.Pool` emits no such event, so a listener-based
    // counter would record 0 for every page size and the comparison below
    // would pass while measuring nothing.
    const countFor = async (limit: number) => {
      const pool = db.$client;
      const original = pool.query.bind(pool);
      let calls = 0;
      // pg's `query` has 6 overloads; a structural cast to a single writable
      // slot is enough for counting calls and re-types nothing else.
      const patchable = pool as unknown as { query: unknown };
      patchable.query = (...args: unknown[]) => {
        calls += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        await client().transactions.list({ limit });
      } finally {
        patchable.query = original;
      }
      return calls;
    };

    const forSix = await countFor(6);
    const forTwo = await countFor(2);

    // Guard the guard: if the wrapper stopped intercepting, both would be 0
    // and the equality below would hold vacuously.
    expect(forTwo).toBeGreaterThan(0);
    expect(forSix).toBe(forTwo);
  });
});

describe("reversedBy (Phase 6b, open question #3)", () => {
  it("is empty for a transaction nothing reverses", async () => {
    const transactionId = await postTransfer(db, tenant, fundingId, walletId, "5.00");

    const transaction = await client().transactions.get({ transactionId });
    expect(transaction.reversedBy).toEqual([]);
  });

  it("names the reversal on the transaction that was reversed, in both list and get", async () => {
    // `reversesTransactionId` only ever points forwards. Before 6b there was
    // no way to ask "has this been reversed?", so ADR 0006:42 assumed a
    // capability that did not exist.
    const originalId = await postTransfer(db, tenant, fundingId, walletId, "5.00");
    const reversal = await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: originalId,
    });

    const viaGet = await client().transactions.get({ transactionId: originalId });
    expect(viaGet.reversedBy).toEqual([reversal.id]);

    const { transactions } = await client().transactions.list({});
    const viaList = transactions.find((candidate) => candidate.id === originalId);
    expect(viaList?.reversedBy).toEqual([reversal.id]);

    // The reversal itself has not been reversed; the two directions are
    // distinct and must not be conflated.
    expect(viaGet.reversesTransactionId).toBeNull();
    const reversalRow = transactions.find((candidate) => candidate.id === reversal.id);
    expect(reversalRow?.reversesTransactionId).toBe(originalId);
    expect(reversalRow?.reversedBy).toEqual([]);
  });

  it("refuses a second reversal even when the balance would allow it", async () => {
    // **This test asserted the opposite until 2026-08-16**, and the change is
    // the point. It used to prove that a transaction could be reversed twice
    // and that `reversedBy` therefore had to be a list. Migration `0007` makes
    // that impossible: a partial unique index on `reverses_transaction_id`
    // means one original yields at most one reversal. ADR 0006's consequences
    // had named this fix and recorded that Phase 6b was scoped not to ship it.
    //
    // The wallet is funded first, and that detail is still load-bearing —
    // inherited from the old version of this test. Each reversal debits the
    // wallet again, so an unfunded second reversal is refused for
    // `insufficient_funds` by the balance invariant rather than by anything
    // reversal-specific. Funding removes that excuse, so the refusal below is
    // attributable to the constraint and to nothing else.
    await postTransfer(db, tenant, fundingId, walletId, "100.00");
    const originalId = await postTransfer(db, tenant, fundingId, walletId, "5.00");

    const first = await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: originalId,
    });

    await expect(
      client().transactions.reverse({
        idempotencyKey: randomUUID(),
        transactionId: originalId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // `reversedBy` stays an array on the wire even though it can now hold at
    // most one element — narrowing it to a scalar would be a breaking change to
    // the published contract for no gain.
    const transaction = await client().transactions.get({ transactionId: originalId });
    expect(transaction.reversedBy).toEqual([first.id]);
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
    // `nextCursor: null` is part of the contract as of Phase 7a, and asserting
    // the whole object rather than just `entries` is deliberate: it fails if a
    // future change starts handing out a cursor for a page that has no rows,
    // which would send a client walking into nothing.
    await expect(client().audit.rejections({})).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  });
});
