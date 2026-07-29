import { randomUUID } from "node:crypto";
import { createPosting, Money, Transaction } from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import {
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
 * `dashboard.summary` — the whole-org aggregate the overview screen reads.
 *
 * The properties worth pinning are the ones a hand-rolled aggregate gets wrong:
 * that a join over postings does not multiply transaction counts, that money is
 * conserved per currency, and that the query count does not grow with the data.
 */

let db: Db;
let reset: () => Promise<void>;
let tenant: SeededTenant;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  tenant = await seedTenant(db, "Summary");
});

function client() {
  return clientFor(db, sessionFor(tenant));
}

/** The response shape, taken from the router client so the helper cannot narrow away fields. */
type Summary = Awaited<ReturnType<ReturnType<typeof clientFor>["dashboard"]["summary"]>>;

function positionFor(summary: Summary, currency: string) {
  return summary.currencies.find((position) => position.currency === currency);
}

describe("an organization with no activity", () => {
  it("returns zeroed totals and empty arrays rather than an error or nulls", async () => {
    // The state every new org starts in. An aggregate over no rows is the
    // classic place a `sum` comes back `NULL` and a mapper turns it into
    // `null`, `NaN`, or a crash.
    const summary = await client().dashboard.summary({});

    expect(summary.currencies).toEqual([]);
    expect(summary.activity).toEqual([]);
    expect(summary.totals).toEqual({
      accountCount: 0,
      transactionCount: 0,
      reversalCount: 0,
      rejectionCount: 0,
    });
    expect(summary.activityWindowDays).toBeGreaterThan(0);
  });

  it("reports accounts that exist but have never been posted to, at zero", async () => {
    await seedAccount(db, tenant.orgId, "normal", "Fresh");

    const summary = await client().dashboard.summary({});
    const usd = positionFor(summary, "USD");

    expect(summary.totals.accountCount).toBe(1);
    expect(usd?.accountCount).toBe(1);
    expect(usd?.normalTotal).toEqual({ amount: "0.00", currency: "USD" });
    expect(usd?.externalTotal).toEqual({ amount: "0.00", currency: "USD" });
    // No transactions, so no activity — an account is not activity.
    expect(summary.activity).toEqual([]);
  });
});

describe("money is conserved per currency", () => {
  it("nets normal and external totals to exactly zero across a multi-currency org", async () => {
    // The invariant the dashboard visualizes. Every transaction is balanced and
    // single-currency, so summing balances across all accounts in a currency
    // sums every signed posting in it — a sum of zeroes. If this ever fails,
    // either the aggregate is wrong or the ledger is.
    const usdFunding = await seedAccount(db, tenant.orgId, "external", "USD Funding");
    const usdWallet = await seedAccount(db, tenant.orgId, "normal", "USD Wallet");
    const eurFunding = await seedAccount(db, tenant.orgId, "external", "EUR Funding", "EUR");
    const eurWallet = await seedAccount(db, tenant.orgId, "normal", "EUR Wallet", "EUR");

    await postTransfer(db, tenant, usdFunding, usdWallet, "125.50");
    await postTransfer(db, tenant, usdFunding, usdWallet, "4.25");

    // A EUR transfer, posted directly so the currency is not USD.
    unwrap(
      await postTransaction(db, {
        orgId: tenant.orgId,
        actorId: tenant.userId,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        transaction: unwrap(
          Transaction.create([
            unwrap(createPosting(eurWallet, "debit", money("90.00", "EUR"))),
            unwrap(createPosting(eurFunding, "credit", money("90.00", "EUR"))),
          ]),
        ),
      }),
    );

    const summary = await client().dashboard.summary({});

    expect(summary.currencies).toHaveLength(2);
    for (const position of summary.currencies) {
      const normal = unwrap(Money.parse(position.normalTotal.amount, position.currency));
      const external = unwrap(Money.parse(position.externalTotal.amount, position.currency));
      expect(normal.minorUnits + external.minorUnits).toBe(0n);
    }

    expect(positionFor(summary, "USD")?.normalTotal).toEqual({
      amount: "129.75",
      currency: "USD",
    });
    expect(positionFor(summary, "EUR")?.normalTotal).toEqual({ amount: "90.00", currency: "EUR" });
    expect(positionFor(summary, "EUR")?.externalTotal).toEqual({
      amount: "-90.00",
      currency: "EUR",
    });
  });

  it("still nets to zero after a reversal", async () => {
    const funding = await seedAccount(db, tenant.orgId, "external", "Funding");
    const wallet = await seedAccount(db, tenant.orgId, "normal", "Wallet");
    const original = await postTransfer(db, tenant, funding, wallet, "40.00");
    await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original,
    });

    const summary = await client().dashboard.summary({});
    const usd = positionFor(summary, "USD");

    expect(usd?.normalTotal).toEqual({ amount: "0.00", currency: "USD" });
    expect(usd?.externalTotal).toEqual({ amount: "0.00", currency: "USD" });
    // A reversal is itself a transaction, so it counts in both figures.
    expect(summary.totals.transactionCount).toBe(2);
    expect(summary.totals.reversalCount).toBe(1);
  });
});

describe("activity series", () => {
  it("counts a multi-leg transaction once, and sums its debit legs once", async () => {
    // The join over postings multiplies each transaction by its leg count. A
    // plain `count(*)` would report this 4-leg payroll run as four
    // transactions; `count(distinct)` is what prevents it. The volume wants the
    // opposite — every leg summed exactly once — so the two aggregates read the
    // same join differently and both have to be right.
    const funding = await seedAccount(db, tenant.orgId, "external", "Payroll Funding");
    const alice = await seedAccount(db, tenant.orgId, "normal", "Alice");
    const bob = await seedAccount(db, tenant.orgId, "normal", "Bob");
    const carol = await seedAccount(db, tenant.orgId, "normal", "Carol");

    unwrap(
      await postTransaction(db, {
        orgId: tenant.orgId,
        actorId: tenant.userId,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        transaction: unwrap(
          Transaction.create([
            unwrap(createPosting(alice, "debit", money("10.00"))),
            unwrap(createPosting(bob, "debit", money("20.00"))),
            unwrap(createPosting(carol, "debit", money("30.00"))),
            unwrap(createPosting(funding, "credit", money("60.00"))),
          ]),
        ),
      }),
    );

    const summary = await client().dashboard.summary({});

    expect(summary.activity).toHaveLength(1);
    expect(summary.activity[0]?.transactionCount).toBe(1);
    // 10 + 20 + 30 debited. The 60.00 credit leg is deliberately excluded:
    // counting both directions would always double what actually moved.
    expect(summary.activity[0]?.debitVolume).toEqual({ amount: "60.00", currency: "USD" });
  });

  it("splits a day into one point per currency", async () => {
    const usdFunding = await seedAccount(db, tenant.orgId, "external", "USD Funding");
    const usdWallet = await seedAccount(db, tenant.orgId, "normal", "USD Wallet");
    const eurFunding = await seedAccount(db, tenant.orgId, "external", "EUR Funding", "EUR");
    const eurWallet = await seedAccount(db, tenant.orgId, "normal", "EUR Wallet", "EUR");

    await postTransfer(db, tenant, usdFunding, usdWallet, "1.00");
    unwrap(
      await postTransaction(db, {
        orgId: tenant.orgId,
        actorId: tenant.userId,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        transaction: unwrap(
          Transaction.create([
            unwrap(createPosting(eurWallet, "debit", money("2.00", "EUR"))),
            unwrap(createPosting(eurFunding, "credit", money("2.00", "EUR"))),
          ]),
        ),
      }),
    );

    const summary = await client().dashboard.summary({});

    expect(summary.activity).toHaveLength(2);
    const currencies = summary.activity.map((point) => point.currency);
    expect(new Set(currencies)).toEqual(new Set(["USD", "EUR"]));
    // Volumes are never mixed across currencies — each point carries its own.
    for (const point of summary.activity) {
      expect(point.debitVolume.currency).toBe(point.currency);
    }
  });

  it("dates every point as a UTC calendar day", async () => {
    const funding = await seedAccount(db, tenant.orgId, "external", "Funding");
    const wallet = await seedAccount(db, tenant.orgId, "normal", "Wallet");
    await postTransfer(db, tenant, funding, wallet, "1.00");

    const summary = await client().dashboard.summary({});

    expect(summary.activity[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("rejections", () => {
  it("counts refused attempts, which post nothing and so appear in no other figure", async () => {
    const emptyWallet = await seedAccount(db, tenant.orgId, "normal", "Empty");
    const target = await seedAccount(db, tenant.orgId, "normal", "Target");

    await expect(
      client().transactions.create({
        idempotencyKey: randomUUID(),
        postings: [
          { accountId: target, direction: "debit", amount: "5.00", currency: "USD" },
          { accountId: emptyWallet, direction: "credit", amount: "5.00", currency: "USD" },
        ],
      }),
    ).rejects.toMatchObject({ status: 422 });

    const summary = await client().dashboard.summary({});

    expect(summary.totals.rejectionCount).toBe(1);
    // A rejection writes no transaction and no posting, so it must not leak
    // into either — a refused transfer that showed up as volume would be a
    // straightforwardly false claim that money moved.
    expect(summary.totals.transactionCount).toBe(0);
    expect(summary.activity).toEqual([]);
  });
});

describe("cost", () => {
  it("issues the same number of queries for a large org as for a small one", async () => {
    // The property that makes this endpoint safe to put on the landing screen.
    // If someone reintroduces a per-account or per-currency lookup, query count
    // grows with the data and this fails.
    const countQueries = async (): Promise<number> => {
      const pool = db.$client;
      const original = pool.query.bind(pool);
      let calls = 0;
      // biome-ignore lint/suspicious/noExplicitAny: pg's `query` has 6 overloads; re-typing them here would add nothing to the assertion.
      (pool as any).query = (...args: unknown[]) => {
        calls += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        await client().dashboard.summary({});
      } finally {
        (pool as any).query = original;
      }
      return calls;
    };

    const whenSmall = await countQueries();

    const funding = await seedAccount(db, tenant.orgId, "external", "Funding");
    for (let index = 0; index < 8; index += 1) {
      const wallet = await seedAccount(db, tenant.orgId, "normal", `Wallet ${index}`);
      await postTransfer(db, tenant, funding, wallet, "1.00");
    }
    // A second currency, so the currency grouping grows too.
    const eurFunding = await seedAccount(db, tenant.orgId, "external", "EUR Funding", "EUR");
    const eurWallet = await seedAccount(db, tenant.orgId, "normal", "EUR Wallet", "EUR");
    unwrap(
      await postTransaction(db, {
        orgId: tenant.orgId,
        actorId: tenant.userId,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        transaction: unwrap(
          Transaction.create([
            unwrap(createPosting(eurWallet, "debit", money("3.00", "EUR"))),
            unwrap(createPosting(eurFunding, "credit", money("3.00", "EUR"))),
          ]),
        ),
      }),
    );

    const whenLarger = await countQueries();

    // Guard the guard: if the wrapper stopped intercepting, both would be 0 and
    // the equality below would hold vacuously.
    expect(whenSmall).toBeGreaterThan(0);
    expect(whenLarger).toBe(whenSmall);
  });
});

describe("tenant isolation", () => {
  it("never totals another organization's accounts or transactions", async () => {
    const other = await seedTenant(db, "OtherSummary");
    const otherFunding = await seedAccount(db, other.orgId, "external", "Their Funding");
    const otherWallet = await seedAccount(db, other.orgId, "normal", "Their Wallet");
    await postTransfer(db, other, otherFunding, otherWallet, "999.00");

    const mine = await client().dashboard.summary({});

    expect(mine.totals).toEqual({
      accountCount: 0,
      transactionCount: 0,
      reversalCount: 0,
      rejectionCount: 0,
    });
    expect(mine.currencies).toEqual([]);
    expect(mine.activity).toEqual([]);

    // And the other tenant does see its own, so the assertion above is about
    // scoping rather than about an empty database.
    const theirs = await clientFor(db, sessionFor(other)).dashboard.summary({});
    expect(theirs.totals.accountCount).toBe(2);
    expect(theirs.totals.transactionCount).toBe(1);
  });
});
