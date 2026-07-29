import { randomUUID } from "node:crypto";

import {
  type Currency,
  createPosting,
  Money,
  type Posting,
  Transaction,
} from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { ORPCError } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { resetRateLimitersForTesting } from "../rate-limit";
import { RESET_CHUNK_SIZE } from "../sandbox/reset-plan";
import { SEED_ACCOUNTS } from "../sandbox/scenarios";
import {
  clientFor,
  money,
  type SeededTenant,
  seedAccount,
  seedMemberIn,
  seedTenant,
  sessionFor,
  unwrap,
} from "../test/fixtures";

/**
 * `sandbox.seed` and `sandbox.reset` against a real Postgres.
 *
 * The claims worth proving here are all about *history*, and none of them
 * survive a mock: that reset terminates and lands every balance on exactly
 * zero, that it does so even on a history containing a reversed reversal, that
 * the seed → reset → seed loop still works on its second lap, and that neither
 * endpoint touches another tenant.
 */

let db: Db;
let reset: () => Promise<void>;
let admin: SeededTenant;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  // The limiters hold in-process state across files; without this, an earlier
  // file's writes would surface here as 429s that look like product bugs.
  resetRateLimitersForTesting();

  admin = await seedTenant(db, "Sandbox", "admin");
});

function asAdmin() {
  return clientFor(db, sessionFor(admin));
}

async function captureError(run: () => Promise<unknown>): Promise<ORPCError<string, any>> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** Drives reset the way a caller does: loop until nothing is left. */
async function resetToCompletion(
  client = asAdmin(),
  runKey = randomUUID(),
): Promise<{ readonly calls: number; readonly zeroed: number }> {
  let calls = 0;
  let zeroed = 0;

  for (;;) {
    const result = await client.sandbox.reset({ idempotencyKey: runKey });
    calls += 1;
    zeroed += result.accountsZeroed;

    if (result.remaining === 0) {
      return { calls, zeroed };
    }
    if (calls > 20) {
      throw new Error(`reset did not terminate: ${result.remaining} accounts still non-zero`);
    }
  }
}

/** The wire account shape, taken from the router client so it cannot drift from the contract. */
type ListedAccount = Awaited<
  ReturnType<ReturnType<typeof clientFor>["accounts"]["list"]>
>["accounts"][number];

/**
 * Every account in the org, walked across pages.
 *
 * `accounts.list` is cursor-paginated as of Phase 7a, and the chunking tests
 * below deliberately create more accounts than one page holds
 * (`RESET_CHUNK_SIZE + 5`). Reading only the first page here would quietly
 * shrink "every balance is zero" to "the first fifty balances are zero" — a
 * test that still passes while checking half of what it claims. Walking is what
 * keeps the assertion as strong as it was before the endpoint was paginated.
 */
async function allAccounts(tenant: SeededTenant = admin): Promise<ListedAccount[]> {
  const client = clientFor(db, sessionFor(tenant));
  const collected: ListedAccount[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const result = await client.accounts.list({ limit: 200, ...(cursor ? { cursor } : {}) });
    collected.push(...result.accounts);
    if (result.nextCursor === null) {
      return collected;
    }
    cursor = result.nextCursor;
  }
  throw new Error("accounts.list walk did not terminate within 50 pages");
}

async function balancesOf(tenant: SeededTenant = admin): Promise<Record<string, string>> {
  const accounts = await allAccounts(tenant);
  return Object.fromEntries(accounts.map((account) => [account.name, account.balance.amount]));
}

async function transactionCount(tenant: SeededTenant = admin): Promise<number> {
  const { transactions } = await clientFor(db, sessionFor(tenant)).transactions.list({
    limit: 200,
  });
  return transactions.length;
}

describe("sandbox.seed", () => {
  it("creates the declared accounts and posts every scenario", async () => {
    const result = await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    for (const spec of SEED_ACCOUNTS) {
      expect(result.accounts.map((account) => account.name)).toContain(spec.name);
    }

    // Four scenarios post, one is refused, and the reversal contributes a
    // second posted entry of its own.
    expect(result.scenarios.filter((scenario) => scenario.outcome === "posted")).toHaveLength(5);
    expect(result.scenarios.filter((scenario) => scenario.outcome === "rejected")).toHaveLength(1);
  });

  it("leaves reconciliation clean across every seeded scenario", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    const verified = await asAdmin().reconciliation.verify({});

    expect(verified.allReconciled).toBe(true);
    expect(verified.accounts.length).toBe(SEED_ACCOUNTS.length);
  });

  it("records the insufficient-funds scenario as a real rejection", async () => {
    const result = await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    const refused = result.scenarios.find((scenario) => scenario.id === "insufficient_funds");
    expect(refused?.outcome).toBe("rejected");
    expect(refused?.reason).toBe("insufficient_funds");

    const { entries } = await asAdmin().audit.rejections({});
    expect(entries.map((entry) => entry.reason)).toContain("insufficient_funds");
  });

  it("conserves money: every balance sums to zero across the org", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    const accounts = await allAccounts();
    const total = accounts.reduce(
      (sum, account) => sum + unwrap(Money.parse(account.balance.amount, "USD")).minorUnits,
      0n,
    );

    expect(total).toBe(0n);
  });

  it("replays under the same run key without posting anything new", async () => {
    const runKey = randomUUID();

    await asAdmin().sandbox.seed({ idempotencyKey: runKey });
    const afterFirst = await transactionCount();
    const balancesAfterFirst = await balancesOf();

    await asAdmin().sandbox.seed({ idempotencyKey: runKey });

    expect(await transactionCount()).toBe(afterFirst);
    expect(await balancesOf()).toEqual(balancesAfterFirst);
  });

  it("seeds an independent run under a different key", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });
    const afterFirst = await transactionCount();

    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    expect(await transactionCount()).toBe(afterFirst * 2);
  });

  it("reuses accounts by name rather than colliding on UNIQUE (org_id, name)", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    const accounts = await allAccounts();

    expect(accounts).toHaveLength(SEED_ACCOUNTS.length);
  });
});

describe("sandbox.reset", () => {
  it("is a no-op on an untouched organization", async () => {
    const result = await asAdmin().sandbox.reset({ idempotencyKey: randomUUID() });

    expect(result).toEqual({ accountsZeroed: 0, remaining: 0, transactionIds: [] });
  });

  it("drives every balance to zero and leaves the accounts active", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    await resetToCompletion();

    const accounts = await allAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.balance.amount).toBe("0.00");
      expect(account.active).toBe(true);
    }
  });

  it("keeps reconciliation clean after unwinding", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });
    await resetToCompletion();

    expect((await asAdmin().reconciliation.verify({})).allReconciled).toBe(true);
  });

  it("only grows history — it never deletes a posting", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });
    const afterSeed = await transactionCount();

    await resetToCompletion();

    expect(await transactionCount()).toBeGreaterThan(afterSeed);
  });

  it("finishes an ordinary sandbox in one call, with no suspense account", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    const { calls } = await resetToCompletion();

    expect(calls).toBe(1);
    // Walked: absence on page one is not absence.
    const accounts = await allAccounts();
    expect(accounts.map((account) => account.name)).toEqual(
      expect.not.arrayContaining([expect.stringContaining("Suspense")]),
    );
  });

  it("replays a chunk under the same run key rather than double-posting", async () => {
    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });

    const runKey = randomUUID();
    const first = await asAdmin().sandbox.reset({ idempotencyKey: runKey });
    const countAfterFirst = await transactionCount();

    // The same run key re-derives the same chunk hash, so this must replay.
    // Balances are already zero, so the planner now returns nothing to do.
    const second = await asAdmin().sandbox.reset({ idempotencyKey: runKey });

    expect(first.remaining).toBe(0);
    expect(second).toEqual({ accountsZeroed: 0, remaining: 0, transactionIds: [] });
    expect(await transactionCount()).toBe(countAfterFirst);
  });
});

describe("sandbox.reset — histories a per-transaction reversal model would fail on", () => {
  /**
   * The case that rules out "post a reversal for every un-reversed
   * transaction" (task D1). `T1 → R1 → R2` leaves `T1`'s effect standing while
   * every transaction in the org is either reversed or is itself a reversal, so
   * a graph-walking reset either selects nothing or oscillates forever. The
   * compensating entry reads balances instead and is indifferent to all of it.
   */
  it("zeroes a ledger whose history contains a reversed reversal", async () => {
    const funding = await seedAccount(db, admin.orgId, "external", "Funding");
    const wallet = await seedAccount(db, admin.orgId, "normal", "Wallet");
    const client = asAdmin();

    const original = await client.transactions.create({
      idempotencyKey: randomUUID(),
      postings: [
        { accountId: wallet, direction: "debit", amount: "100.00", currency: "USD" },
        { accountId: funding, direction: "credit", amount: "100.00", currency: "USD" },
      ],
    });

    const reversal = await client.transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.id,
    });

    await client.transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: reversal.id,
    });

    // The double reversal re-applied the original, so the ledger is not at zero.
    expect((await balancesOf())["Wallet"]).toBe("100.00");

    await resetToCompletion();

    expect((await balancesOf())["Wallet"]).toBe("0.00");
    expect((await balancesOf())["Funding"]).toBe("0.00");
  });
});

describe("sandbox.reset — beyond one chunk", () => {
  /**
   * Funds `count` accounts in a single transaction. `postTransaction` places no
   * cap on leg count — `MAX_POSTINGS` is an API-boundary bound — so this reaches
   * a past-the-chunk-size ledger in one write instead of a hundred.
   */
  async function fundManyAccounts(count: number, currency: Currency = "USD"): Promise<void> {
    const source = await seedAccount(
      db,
      admin.orgId,
      "external",
      `Bulk Funding ${currency}`,
      currency,
    );
    const postings: Posting[] = [];
    let total = 0n;

    for (let index = 0; index < count; index += 1) {
      const accountId = await seedAccount(
        db,
        admin.orgId,
        "normal",
        `Bulk ${currency} ${String(index).padStart(3, "0")}`,
        currency,
      );
      const amount = money(`${index + 1}.00`, currency);
      postings.push(unwrap(createPosting(accountId, "debit", amount)));
      total += amount.minorUnits;
    }

    postings.push(
      unwrap(createPosting(source, "credit", unwrap(Money.ofMinorUnits(total, currency)))),
    );

    unwrap(
      await postTransaction(db, {
        orgId: admin.orgId,
        actorId: admin.userId,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        transaction: unwrap(Transaction.create(postings)),
      }),
    );
  }

  it("chunks through more non-zero accounts than one transaction can hold", async () => {
    await fundManyAccounts(RESET_CHUNK_SIZE + 5);

    const { calls } = await resetToCompletion();

    expect(calls).toBeGreaterThan(1);
    for (const [, amount] of Object.entries(await balancesOf())) {
      expect(amount).toBe("0.00");
    }
  });

  it("opens a suspense account only when chunking actually requires one", async () => {
    await fundManyAccounts(RESET_CHUNK_SIZE + 5);
    await resetToCompletion();

    // Walked, not first-page: this test creates 104 accounts, and "Sandbox
    // Suspense USD" sorts after every "Bulk USD nnn", so it is not on page one.
    const accounts = await allAccounts();
    const suspense = accounts.filter((account) => account.name.startsWith("Sandbox Suspense"));

    expect(suspense).toHaveLength(1);
    expect(suspense[0]?.type).toBe("external");
    expect(suspense[0]?.balance.amount).toBe("0.00");
  });

  it("keeps reconciliation clean through a chunked reset", async () => {
    await fundManyAccounts(RESET_CHUNK_SIZE + 5);
    await resetToCompletion();

    expect((await asAdmin().reconciliation.verify({})).allReconciled).toBe(true);
  });

  it("drains two currencies without ever mixing them in one transaction", async () => {
    await fundManyAccounts(3, "USD");
    await fundManyAccounts(3, "EUR");

    await resetToCompletion();

    for (const [, amount] of Object.entries(await balancesOf())) {
      expect(amount).toMatch(/^0\.00$/);
    }
    expect((await asAdmin().reconciliation.verify({})).allReconciled).toBe(true);
  });
});

describe("the sandbox loop", () => {
  it("survives seed → reset → seed → reset with reconciliation clean throughout", async () => {
    const client = asAdmin();

    for (const lap of [1, 2]) {
      await client.sandbox.seed({ idempotencyKey: randomUUID() });

      expect((await client.reconciliation.verify({})).allReconciled).toBe(true);
      expect((await balancesOf())["Operating"], `lap ${lap} funded`).not.toBe("0.00");

      await resetToCompletion(client);

      expect((await client.reconciliation.verify({})).allReconciled).toBe(true);
      expect((await balancesOf())["Operating"], `lap ${lap} unwound`).toBe("0.00");
    }
  });
});

describe("sandbox permissions and tenancy", () => {
  it("refuses a viewer in the same organization", async () => {
    const viewerId = await seedMemberIn(db, admin.orgId, "member");
    const viewer = clientFor(db, { userId: viewerId, activeOrganizationId: admin.orgId });

    const seedError = await captureError(() =>
      viewer.sandbox.seed({ idempotencyKey: randomUUID() }),
    );
    const resetError = await captureError(() =>
      viewer.sandbox.reset({ idempotencyKey: randomUUID() }),
    );

    expect(seedError.code).toBe("FORBIDDEN");
    expect(seedError.data.reason).toBe("insufficient_role");
    expect(resetError.code).toBe("FORBIDDEN");
    expect(resetError.data.reason).toBe("insufficient_role");
  });

  it("leaves another organization untouched", async () => {
    const other = await seedTenant(db, "Other", "admin");
    const otherWallet = await seedAccount(db, other.orgId, "normal", "Other Wallet");

    await asAdmin().sandbox.seed({ idempotencyKey: randomUUID() });
    await resetToCompletion();

    const otherAccounts = await allAccounts(other);

    expect(otherAccounts).toHaveLength(1);
    expect(otherAccounts[0]?.id).toBe(otherWallet);
    // Nothing the other tenant owns was created, posted to, or unwound.
    expect(await transactionCount(other)).toBe(0);
  });
});
