import { randomUUID } from "node:crypto";
import type { Db } from "@fintech-ledger-sandbox/db";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { ORPCError } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { resetRateLimitersForTesting } from "../rate-limit";
import {
  clientFor,
  type SeededTenant,
  seedAccount,
  seedMemberIn,
  seedTenant,
  sessionFor,
} from "../test/fixtures";

/**
 * The write surface: `accounts.create`, `transactions.create`,
 * `transactions.reverse`.
 *
 * Everything here runs against a real Postgres through the real middleware,
 * because the claims worth testing are the ones a mock cannot make: that a
 * viewer is refused, that an idempotency key replays rather than double-posts,
 * that an overdraw writes nothing, and that a rejection leaves an audit trail.
 */

let db: Db;
let reset: () => Promise<void>;
let admin: SeededTenant;
let funding: string;
let wallet: string;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  // The limiters hold state in-process across files. Without this, one file's
  // writes would exhaust the next file's budget and produce 429s that look
  // like product bugs.
  resetRateLimitersForTesting();

  admin = await seedTenant(db, "Writer", "admin");
  funding = await seedAccount(db, admin.orgId, "external", "Funding");
  wallet = await seedAccount(db, admin.orgId, "normal", "Wallet");
});

function asAdmin() {
  return clientFor(db, sessionFor(admin));
}

/** A balanced transfer: `wallet` debited, `funding` credited. */
function transfer(amount: string, key = randomUUID()) {
  return {
    idempotencyKey: key,
    postings: [
      { accountId: wallet, direction: "debit" as const, amount, currency: "USD" },
      { accountId: funding, direction: "credit" as const, amount, currency: "USD" },
    ],
  };
}

/**
 * Money flowing OUT of `wallet`: credited (decreasing), with `funding`
 * debited. The sign convention is `core`'s — debit positive, credit negative —
 * so this is the direction that can overdraw a `normal` account, whereas
 * `transfer()` above only ever increases it.
 */
function withdraw(amount: string, key = randomUUID()) {
  return {
    idempotencyKey: key,
    postings: [
      { accountId: wallet, direction: "credit" as const, amount, currency: "USD" },
      { accountId: funding, direction: "debit" as const, amount, currency: "USD" },
    ],
  };
}

async function captureError(
  run: () => Promise<unknown>,
): Promise<ORPCError<string, Record<string, unknown>>> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

async function rejectionReasons(): Promise<string[]> {
  const { entries } = await asAdmin().audit.rejections({});
  return entries.map((entry) => entry.reason ?? "");
}

describe("authorization", () => {
  it("refuses a viewer on every write endpoint", async () => {
    // adminProcedure's first real coverage — Phase 4a defined it but nothing
    // used it, so only the pure `canWrite` predicate was tested.
    const viewer = await seedTenant(db, "Viewer", "member");
    const viewerAccount = await seedAccount(db, viewer.orgId, "normal", "Theirs");
    const client = clientFor(db, sessionFor(viewer));

    const create = await captureError(() =>
      client.accounts.create({ name: "Nope", currency: "USD", type: "normal" }),
    );
    const post = await captureError(() =>
      client.transactions.create({
        idempotencyKey: randomUUID(),
        postings: [
          { accountId: viewerAccount, direction: "debit", amount: "1.00", currency: "USD" },
          { accountId: viewerAccount, direction: "credit", amount: "1.00", currency: "USD" },
        ],
      }),
    );
    const rev = await captureError(() =>
      client.transactions.reverse({ idempotencyKey: randomUUID(), transactionId: randomUUID() }),
    );

    for (const error of [create, post, rev]) {
      expect(error.status).toBe(403);
      expect(error.data).toEqual({ reason: "insufficient_role" });
    }
  });

  it("admits an owner, which maps to the admin ledger role", async () => {
    const owner = await seedTenant(db, "Owner", "owner");
    await expect(
      clientFor(db, sessionFor(owner)).accounts.create({
        name: "Ok",
        currency: "USD",
        type: "normal",
      }),
    ).resolves.toMatchObject({ name: "Ok" });
  });
});

describe("accounts.create", () => {
  it("creates an account with a zero balance", async () => {
    const account = await asAdmin().accounts.create({
      name: "Payroll",
      currency: "USD",
      type: "normal",
    });

    expect(account.name).toBe("Payroll");
    expect(account.balance).toEqual({ amount: "0.00", currency: "USD" });
    expect(account.active).toBe(true);
    expect(account).not.toHaveProperty("orgId");
  });

  it("returns 409 for a duplicate name rather than a 500", async () => {
    // Before Phase 4b this escaped as a raw DrizzleQueryError and surfaced as
    // an unhandled 500.
    await asAdmin().accounts.create({ name: "Payroll", currency: "USD", type: "normal" });
    const error = await captureError(() =>
      asAdmin().accounts.create({ name: "Payroll", currency: "USD", type: "normal" }),
    );

    expect(error.status).toBe(409);
    expect(error.data).toEqual({ reason: "account_name_taken" });
  });

  it("allows the same account name in a different organization", async () => {
    // The uniqueness constraint is (org_id, name), not (name) — a global
    // constraint would leak one tenant's naming into another's.
    await asAdmin().accounts.create({ name: "Shared", currency: "USD", type: "normal" });
    const other = await seedTenant(db, "Other", "admin");

    await expect(
      clientFor(db, sessionFor(other)).accounts.create({
        name: "Shared",
        currency: "USD",
        type: "normal",
      }),
    ).resolves.toMatchObject({ name: "Shared" });
  });

  it("rejects an unsupported currency rather than guessing an exponent", async () => {
    const error = await captureError(() =>
      asAdmin().accounts.create({ name: "Weird", currency: "XYZ", type: "normal" }),
    );

    expect(error.status).toBe(422);
    expect(error.data).toEqual({ reason: "unsupported_currency" });
  });
});

describe("transactions.create", () => {
  it("posts a balanced transfer and returns resulting balances", async () => {
    // Fund the wallet first: crediting `funding` (external) is allowed to go
    // negative, debiting `wallet` (normal) is not.
    const posted = await asAdmin().transactions.create(transfer("100.00"));

    expect(posted.postings).toHaveLength(2);
    expect(posted.reversesTransactionId).toBeNull();

    const balances = Object.fromEntries(
      posted.balances.map((b) => [b.accountId, b.balance.amount]),
    );
    expect(balances[wallet]).toBe("100.00");
    expect(balances[funding]).toBe("-100.00");
  });

  it("posts an N-leg transaction with a fee split", async () => {
    // The shape a transfer-only API could not express without an escape hatch.
    const fee = await seedAccount(db, admin.orgId, "normal", "Fees");
    const posted = await asAdmin().transactions.create({
      idempotencyKey: randomUUID(),
      postings: [
        { accountId: wallet, direction: "debit", amount: "95.00", currency: "USD" },
        { accountId: fee, direction: "debit", amount: "5.00", currency: "USD" },
        { accountId: funding, direction: "credit", amount: "100.00", currency: "USD" },
      ],
    });

    expect(posted.postings).toHaveLength(3);
    const balances = Object.fromEntries(
      posted.balances.map((b) => [b.accountId, b.balance.amount]),
    );
    expect(balances[wallet]).toBe("95.00");
    expect(balances[fee]).toBe("5.00");
  });

  describe("domain validation", () => {
    it("rejects a single-leg transaction with too_few_postings", async () => {
      const error = await captureError(() =>
        asAdmin().transactions.create({
          idempotencyKey: randomUUID(),
          postings: [{ accountId: wallet, direction: "debit", amount: "1.00", currency: "USD" }],
        }),
      );

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "too_few_postings" });
    });

    it("rejects an unbalanced transaction", async () => {
      const error = await captureError(() =>
        asAdmin().transactions.create({
          idempotencyKey: randomUUID(),
          postings: [
            { accountId: wallet, direction: "debit", amount: "100.00", currency: "USD" },
            { accountId: funding, direction: "credit", amount: "99.00", currency: "USD" },
          ],
        }),
      );

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "unbalanced_transaction" });
    });

    it("rejects mixed currencies", async () => {
      const error = await captureError(() =>
        asAdmin().transactions.create({
          idempotencyKey: randomUUID(),
          postings: [
            { accountId: wallet, direction: "debit", amount: "100.00", currency: "USD" },
            { accountId: funding, direction: "credit", amount: "100.00", currency: "EUR" },
          ],
        }),
      );

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "currency_mismatch" });
    });

    it("rejects a zero amount", async () => {
      const error = await captureError(() => asAdmin().transactions.create(transfer("0.00")));

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "non_positive_amount" });
    });

    it("rejects excess precision rather than rounding it away", async () => {
      const error = await captureError(() => asAdmin().transactions.create(transfer("1.005")));

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "invalid_amount" });
    });

    it("rejects an over-long amount string at the contract boundary", async () => {
      // The Phase 2 deferral: BigInt parsing is superlinear in digit count, so
      // the cap must reject before Money.parse is reached.
      await expect(asAdmin().transactions.create(transfer("9".repeat(100)))).rejects.toMatchObject({
        status: 400,
      });
    });

    it("rejects an amount that would overflow the bigint column with 422, not 500", async () => {
      // A 30-character amount passes the length cap and parses into a valid
      // `Money` — but `ledger_posting.amount` is Postgres int8, so the insert
      // would fail with 22003 and surface as an unaudited 500. The bound is
      // enforced at the contract, so this is a typed 422 instead.
      const error = await captureError(() =>
        asAdmin().transactions.create(transfer("9".repeat(30))),
      );

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "invalid_amount" });
    });

    it("still accepts the largest amount the column can hold", async () => {
      // Boundary check in the other direction: the bound must not reject a
      // legitimately storable value. int8 max is 9223372036854775807 minor
      // units, i.e. 92233720368547758.07 at exponent 2.
      const posted = await asAdmin().transactions.create(transfer("92233720368547758.07"));

      // It posts. `wallet` is debited (increasing) and `funding` is external,
      // so nothing else rejects it — the bound admits exactly the values the
      // column can hold, and one minor unit more is refused by the test above.
      const balances = Object.fromEntries(
        posted.balances.map((b) => [b.accountId, b.balance.amount]),
      );
      expect(balances[wallet]).toBe("92233720368547758.07");
    });

    it("records every pre-persistence rejection in the audit log", async () => {
      // These all fail at Transaction.create, before postTransaction runs — so
      // its own rejection-audit path never sees them. Until Phase 4b they left
      // no trace at all, contradicting ledger.md line 54.
      await captureError(() => asAdmin().transactions.create(transfer("0.00")));
      await captureError(() =>
        asAdmin().transactions.create({
          idempotencyKey: randomUUID(),
          postings: [
            { accountId: wallet, direction: "debit", amount: "100.00", currency: "USD" },
            { accountId: funding, direction: "credit", amount: "99.00", currency: "USD" },
          ],
        }),
      );

      const reasons = await rejectionReasons();
      expect(reasons).toContain("non_positive_amount");
      expect(reasons).toContain("unbalanced_transaction");
    });
  });

  describe("funds and account state", () => {
    it("rejects an overdraw of a normal account and writes nothing", async () => {
      // `wallet` is `normal` and starts at zero, so withdrawing anything drives
      // it negative — which invariant #6 forbids. The mirror case is allowed:
      // `funding` is `external` and may go negative freely.
      const error = await captureError(() => asAdmin().transactions.create(withdraw("50.00")));

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "insufficient_funds" });

      const account = await asAdmin().accounts.get({ accountId: wallet });
      expect(account.balance.amount).toBe("0.00");
      await expect(asAdmin().transactions.list({})).resolves.toMatchObject({ transactions: [] });
      expect(await rejectionReasons()).toContain("insufficient_funds");
    });

    it("rejects posting to an inactive account with 422, not 404", async () => {
      // No deactivate endpoint exists yet, so the row is flipped directly —
      // which is exactly why the check lives under the row lock rather than in
      // a handler.
      await asAdmin().transactions.create(transfer("100.00"));
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`UPDATE ledger_account SET active = false WHERE id = ${wallet}`);

      const error = await captureError(() => asAdmin().transactions.create(transfer("10.00")));

      expect(error.status).toBe(422);
      expect(error.data).toEqual({ reason: "account_inactive" });
    });

    it("reports an account from another org as 404, not 422", async () => {
      // Ordering matters in lockAccounts: existence is checked for every id
      // before activity, so a cross-org probe can never learn "inactive",
      // which would confirm the row exists elsewhere.
      const other = await seedTenant(db, "Other", "admin");
      const theirs = await seedAccount(db, other.orgId, "normal", "Theirs");

      const error = await captureError(() =>
        asAdmin().transactions.create({
          idempotencyKey: randomUUID(),
          postings: [
            { accountId: theirs, direction: "debit", amount: "1.00", currency: "USD" },
            { accountId: funding, direction: "credit", amount: "1.00", currency: "USD" },
          ],
        }),
      );

      expect(error.status).toBe(404);
      expect(error.data).toEqual({ reason: "account_not_found" });
    });
  });

  describe("idempotency", () => {
    it("replays the original on the same key and payload", async () => {
      const request = transfer("100.00");
      const first = await asAdmin().transactions.create(request);
      expect(first.replayed).toBe(false);
      const second = await asAdmin().transactions.create(request);

      expect(second.id).toBe(first.id);
      expect(second.replayed).toBe(true);
      const { transactions } = await asAdmin().transactions.list({});
      expect(transactions).toHaveLength(1);
    });

    it("replays when the same legs arrive in a different order", async () => {
      // The reason requestHash sorts. Transaction.deltas() nets by account
      // before persisting, so leg order has no ledger effect — hashing the
      // caller's order would manufacture a 409 for the same request.
      const key = randomUUID();
      const first = await asAdmin().transactions.create({
        idempotencyKey: key,
        postings: [
          { accountId: wallet, direction: "debit", amount: "100.00", currency: "USD" },
          { accountId: funding, direction: "credit", amount: "100.00", currency: "USD" },
        ],
      });
      const reordered = await asAdmin().transactions.create({
        idempotencyKey: key,
        postings: [
          { accountId: funding, direction: "credit", amount: "100.00", currency: "USD" },
          { accountId: wallet, direction: "debit", amount: "100.00", currency: "USD" },
        ],
      });

      expect(reordered.id).toBe(first.id);
    });

    it("returns 409 for the same key with a genuinely different payload", async () => {
      const key = randomUUID();
      await asAdmin().transactions.create(transfer("100.00", key));
      const error = await captureError(() =>
        asAdmin().transactions.create(transfer("250.00", key)),
      );

      expect(error.status).toBe(409);
      expect(error.data).toEqual({ reason: "idempotency_conflict" });
      expect(await rejectionReasons()).toContain("idempotency_conflict");
    });

    it("posts exactly once under real concurrency on a shared key", async () => {
      // Invariant #4. Promise.all over the same client, so these genuinely
      // race on the UNIQUE (org_id, key) index rather than running in sequence.
      const request = transfer("100.00");
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => asAdmin().transactions.create(request)),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThan(0);

      const ids = new Set(
        fulfilled.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id),
      );
      expect(ids.size).toBe(1);

      const { transactions } = await asAdmin().transactions.list({});
      expect(transactions).toHaveLength(1);
    });
  });
});

describe("transactions.reverse", () => {
  it("refuses a second reversal of the same original", async () => {
    // ADR 0006 recorded this in its consequences and named the fix: without a
    // unique index on `reverses_transaction_id`, two reversals of one original
    // under two different keys both succeed whenever balances allow, and
    // **double the correction** — leaving the ledger further from the truth
    // than before anyone tried to fix it. Migration 0007 makes it a constraint
    // rather than a convention, so two concurrent reversers cannot both pass a
    // read-then-write check.
    // The wallet is funded first, and that detail is load-bearing. Each reversal
    // debits the wallet again, so an unfunded double reversal is refused for
    // `insufficient_funds` — by the balance invariant, not by anything
    // reversal-specific. Funding removes that excuse, so what refuses the second
    // call here is the constraint and nothing else.
    await asAdmin().transactions.create(transfer("500.00"));
    const original = await asAdmin().transactions.create(transfer("100.00"));

    await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.id,
    });

    const second = await captureError(() =>
      asAdmin().transactions.reverse({
        idempotencyKey: randomUUID(),
        transactionId: original.id,
      }),
    );

    // A typed 409, not an unmapped 500 — a 500 is the one outcome this
    // ledger's audit trail cannot explain.
    expect(second.code).toBe("CONFLICT");
    expect(second.data.reason).toBe("already_reversed");

    // The correction happened exactly once: 500 funded + 100 posted - 100 reversed.
    const { accounts } = await asAdmin().accounts.list({});
    expect(accounts.find((account) => account.id === wallet)?.balance.amount).toBe("500.00");
  });

  it("still allows reversing a reversal — the chain is untouched", async () => {
    // The constraint forbids two rows pointing at the *same* original. A chain
    // targets a different transaction id each step, so legitimate undo/redo
    // keeps working; blocking it would forbid a valid operation.
    const original = await asAdmin().transactions.create(transfer("100.00"));

    const first = await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.id,
    });

    const second = await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: first.id,
    });

    expect(second.reversesTransactionId).toBe(first.id);

    // Undo of the undo re-applies the original effect.
    const { accounts } = await asAdmin().accounts.list({});
    expect(accounts.find((account) => account.id === wallet)?.balance.amount).toBe("100.00");
  });

  it("mirrors a transaction, links it, and restores balances", async () => {
    const original = await asAdmin().transactions.create(transfer("100.00"));

    const reversal = await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.id,
    });

    expect(reversal.id).not.toBe(original.id);
    expect(reversal.reversesTransactionId).toBe(original.id);

    const balances = Object.fromEntries(
      reversal.balances.map((b) => [b.accountId, b.balance.amount]),
    );
    expect(balances[wallet]).toBe("0.00");
    expect(balances[funding]).toBe("0.00");
  });

  it("leaves the original's postings untouched — history is append-only", async () => {
    const original = await asAdmin().transactions.create(transfer("100.00"));
    const before = await asAdmin().transactions.get({ transactionId: original.id });

    const reversal = await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.id,
    });

    const after = await asAdmin().transactions.get({ transactionId: original.id });

    // Everything *stored* about the original is byte-identical. This is the
    // append-only property, and it is asserted on the whole object minus one
    // field rather than field-by-field, so a newly added stored column is
    // covered by this test automatically instead of being silently exempt.
    const { reversedBy: reversedByBefore, ...storedBefore } = before;
    const { reversedBy: reversedByAfter, ...storedAfter } = after;
    expect(storedAfter).toEqual(storedBefore);

    // `reversedBy` is excluded above because it is *derived*, not stored: it
    // reports which other rows point at this one. It changing is the correct
    // observable consequence of appending a reversal, and is the opposite of a
    // mutation — nothing on the original row or its postings was rewritten.
    // Asserted rather than merely excluded, so dropping it from the response
    // still fails this test (Phase 6b).
    expect(reversedByBefore).toEqual([]);
    expect(reversedByAfter).toEqual([reversal.id]);
  });

  it("permits reversing a reversal, which re-applies the original effect", async () => {
    const original = await asAdmin().transactions.create(transfer("100.00"));
    const reversal = await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.id,
    });

    const reReversal = await asAdmin().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: reversal.id,
    });

    expect(reReversal.reversesTransactionId).toBe(reversal.id);
    const balances = Object.fromEntries(
      reReversal.balances.map((b) => [b.accountId, b.balance.amount]),
    );
    expect(balances[wallet]).toBe("100.00");
  });

  it("reports another org's transaction as 404 — the self-FK is org-blind", async () => {
    // Without the org-scoped lookup in the handler, this would reverse another
    // tenant's transaction, because ledger_transaction's self-FK does not
    // constrain org.
    const other = await seedTenant(db, "Other", "admin");
    const theirFunding = await seedAccount(db, other.orgId, "external", "Funding");
    const theirWallet = await seedAccount(db, other.orgId, "normal", "Wallet");
    const theirs = await clientFor(db, sessionFor(other)).transactions.create({
      idempotencyKey: randomUUID(),
      postings: [
        { accountId: theirWallet, direction: "debit", amount: "10.00", currency: "USD" },
        { accountId: theirFunding, direction: "credit", amount: "10.00", currency: "USD" },
      ],
    });

    const crossOrg = await captureError(() =>
      asAdmin().transactions.reverse({ idempotencyKey: randomUUID(), transactionId: theirs.id }),
    );
    const missing = await captureError(() =>
      asAdmin().transactions.reverse({ idempotencyKey: randomUUID(), transactionId: randomUUID() }),
    );

    expect(crossOrg.status).toBe(404);
    expect(crossOrg.code).toBe(missing.code);
    expect(crossOrg.data).toEqual(missing.data);
  });
});

describe("rate limiting", () => {
  // The two limits differ (30/min per user, 60/min per org), so a test that
  // just hammers one actor only ever proves the USER limit works. Reaching the
  // org limit requires two admins in the SAME org — which is also the only way
  // to show that one actor cannot starve their colleagues.

  it("trips the per-user limit first for a single actor", async () => {
    const errors: ORPCError<string, Record<string, unknown>>[] = [];

    for (let i = 0; i < 40; i += 1) {
      try {
        await asAdmin().accounts.create({ name: `Acct ${i}`, currency: "USD", type: "normal" });
      } catch (error) {
        if (error instanceof ORPCError) {
          errors.push(error);
          break;
        }
        throw error;
      }
    }

    const limited = errors[0];
    expect(limited?.status).toBe(429);
    expect(limited?.data).toMatchObject({ reason: "rate_limited", scope: "user" });
    expect(limited?.data?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("trips the per-org limit once two admins together exceed it", async () => {
    // 30 + 30 exhausts the user budgets and lands exactly on the org ceiling of
    // 60; a third actor's first write is then refused with scope "organization".
    // Without a co-member this branch is unreachable, which is why the earlier
    // version of this test only ever observed the user limit.
    const second = await seedMemberIn(db, admin.orgId, "admin");
    const third = await seedMemberIn(db, admin.orgId, "admin");

    for (const [actor, label] of [
      [admin.userId, "a"],
      [second, "b"],
    ] as const) {
      const client = clientFor(db, { userId: actor, activeOrganizationId: admin.orgId });
      for (let i = 0; i < 30; i += 1) {
        await client.accounts.create({ name: `${label}-${i}`, currency: "USD", type: "normal" });
      }
    }

    const fresh = clientFor(db, { userId: third, activeOrganizationId: admin.orgId });
    const error = await captureError(() =>
      fresh.accounts.create({ name: "over", currency: "USD", type: "normal" }),
    );

    // The third admin has spent none of their own 30, so only the org ceiling
    // can be what refuses them.
    expect(error.status).toBe(429);
    expect(error.data).toMatchObject({ reason: "rate_limited", scope: "organization" });
  });

  it("does not let one organization exhaust another's budget", async () => {
    // Invariant #5 applied to availability: keying by org is what makes this
    // true, and keying by IP would have made it false.
    for (let i = 0; i < 30; i += 1) {
      try {
        await asAdmin().accounts.create({ name: `Fill ${i}`, currency: "USD", type: "normal" });
      } catch {
        break;
      }
    }

    const other = await seedTenant(db, "Unaffected", "admin");
    await expect(
      clientFor(db, sessionFor(other)).accounts.create({
        name: "Fine",
        currency: "USD",
        type: "normal",
      }),
    ).resolves.toMatchObject({ name: "Fine" });
  });

  it("does not charge the org budget for a request the role check refuses", async () => {
    // The viewer must be in the SAME org as the admin, or this proves nothing:
    // a viewer in a different org could not touch this org's budget either way.
    const viewerId = await seedMemberIn(db, admin.orgId, "member");
    const viewerClient = clientFor(db, { userId: viewerId, activeOrganizationId: admin.orgId });

    for (let i = 0; i < 40; i += 1) {
      const error = await captureError(() =>
        viewerClient.accounts.create({ name: `X ${i}`, currency: "USD", type: "normal" }),
      );
      expect(error.data).toEqual({ reason: "insufficient_role" });
    }

    // 40 refused attempts exceed both ceilings. If any had been charged, the
    // admin's very next write in this same org would be a 429.
    await expect(
      asAdmin().accounts.create({ name: "Still fine", currency: "USD", type: "normal" }),
    ).resolves.toMatchObject({ name: "Still fine" });
  });

  it("does not charge the org budget for a request the user limit refuses", async () => {
    // The ordering fix: `limit()` consumes as it checks, so charging the org
    // first would spend an org token on a request the user limit then rejects.
    // One admin could burn all 60 org tokens with 30 writes and 30 refusals.
    const co = await seedMemberIn(db, admin.orgId, "admin");

    for (let i = 0; i < 45; i += 1) {
      try {
        await asAdmin().accounts.create({ name: `Burn ${i}`, currency: "USD", type: "normal" });
      } catch (error) {
        if (!(error instanceof ORPCError)) throw error;
        expect(error.data).toMatchObject({ scope: "user" });
      }
    }

    // The first admin made 30 successful writes and 15 refused ones. Only the
    // 30 should have been charged to the org, leaving 30 for their colleague.
    const coClient = clientFor(db, { userId: co, activeOrganizationId: admin.orgId });
    await expect(
      coClient.accounts.create({ name: "Colleague", currency: "USD", type: "normal" }),
    ).resolves.toMatchObject({ name: "Colleague" });
  });
});
