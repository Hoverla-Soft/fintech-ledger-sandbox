import { randomUUID } from "node:crypto";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { reconcileAccounts } from "@fintech-ledger-sandbox/db/repositories";
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
 * `transactions.exchange` — a cross-currency transfer as two linked
 * single-currency transactions (`docs/adr/0010-cross-currency-exchange.md`).
 *
 * The properties worth pinning are the ones the two-transaction design exists to
 * preserve: every existing invariant still holds, the pair commits or neither
 * does, and the FX position lands somewhere real rather than vanishing into a
 * rounding difference.
 */

let db: Db;
let reset: () => Promise<void>;
let tenant: SeededTenant;
let usdFunding: string;
let usdWallet: string;
let eurWallet: string;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  tenant = await seedTenant(db, "Exchange");
  usdFunding = await seedAccount(db, tenant.orgId, "external", "USD Funding");
  usdWallet = await seedAccount(db, tenant.orgId, "normal", "USD Wallet");
  eurWallet = await seedAccount(db, tenant.orgId, "normal", "EUR Wallet", "EUR");
  // Fund the USD wallet so it can afford to send. A `normal` account may not go
  // negative (invariant #6), so without this every exchange below would be
  // refused for insufficient funds rather than testing what it means to test.
  await postTransfer(db, tenant, usdFunding, usdWallet, "1000.00");
});

function client() {
  return clientFor(db, sessionFor(tenant));
}

async function exchange(
  overrides: Partial<Parameters<ReturnType<typeof client>["transactions"]["exchange"]>[0]> = {},
) {
  return client().transactions.exchange({
    idempotencyKey: randomUUID(),
    fromAccountId: usdWallet,
    toAccountId: eurWallet,
    amount: "100.00",
    rate: "0.92",
    targetAmount: "92.00",
    ...overrides,
  });
}

async function balanceOf(accountId: string): Promise<string> {
  return (await client().accounts.get({ accountId })).balance.amount;
}

async function accountNamed(name: string) {
  const { accounts } = await client().accounts.list({ limit: 200 });
  return accounts.find((account) => account.name === name);
}

describe("a successful exchange", () => {
  it("moves the source currency out and the target currency in", async () => {
    const result = await exchange();

    expect(result.source.currency).toBe("USD");
    expect(result.target.currency).toBe("EUR");
    expect(result.rate).toBe("0.92");

    expect(await balanceOf(usdWallet)).toBe("900.00");
    expect(await balanceOf(eurWallet)).toBe("92.00");
  });

  it("leaves the offsetting FX position on a bridge account per currency", async () => {
    await exchange();

    // This is where an FX position belongs: +100 USD and -92 EUR, held openly on
    // two accounts, rather than disappearing into a rounding difference.
    expect((await accountNamed("FX Bridge USD"))?.balance.amount).toBe("100.00");
    expect((await accountNamed("FX Bridge EUR"))?.balance.amount).toBe("-92.00");
    // External, because the target-side bridge is credited and so goes negative,
    // which invariant #6 forbids for a `normal` account.
    expect((await accountNamed("FX Bridge EUR"))?.type).toBe("external");
  });

  it("opens each bridge account once, however many exchanges run", async () => {
    await exchange();
    await exchange();
    await exchange();

    const { accounts } = await client().accounts.list({ limit: 200 });
    expect(accounts.filter((account) => account.name.startsWith("FX Bridge"))).toHaveLength(2);
    expect((await accountNamed("FX Bridge USD"))?.balance.amount).toBe("300.00");
  });

  it("links the two legs, and records the rate on the target only", async () => {
    const result = await exchange();

    const source = await client().transactions.get({ transactionId: result.source.id });
    const target = await client().transactions.get({ transactionId: result.target.id });

    // The stored direction: target -> source.
    expect(target.fxSourceTransactionId).toBe(source.id);
    expect(target.fxRate).toBe("0.92");
    // The derived inverse: source -> target.
    expect(source.fxTargetTransactionId).toBe(target.id);
    // A rate belongs to the leg it produced. Putting it on both would invite a
    // reader to apply it twice.
    expect(source.fxRate).toBeNull();
    expect(source.fxSourceTransactionId).toBeNull();
    expect(target.fxTargetTransactionId).toBeNull();
  });

  it("keeps every account reconciled, and money conserved within each currency", async () => {
    await exchange();

    // Invariant #2, unchanged by the exchange. This is the payoff of two
    // single-currency transactions: reconciliation needed no modification at all.
    for (const row of await reconcileAccounts(db, tenant.orgId)) {
      expect(row.reconciled, `${row.accountName} drifted`).toBe(true);
    }

    // Conservation per currency still holds — each leg nets to zero inside its
    // own currency, so the sum over all accounts in a currency is still zero.
    const summary = await client().dashboard.summary({});
    for (const position of summary.currencies) {
      const normal = Number(position.normalTotal.amount);
      const external = Number(position.externalTotal.amount);
      expect(normal + external, `${position.currency} did not net to zero`).toBeCloseTo(0, 8);
    }
  });

  it("shows both legs in history, each in its own currency", async () => {
    await exchange();

    const { transactions } = await client().transactions.list({ limit: 200 });
    const currencies = transactions.map((transaction) => transaction.currency);

    expect(currencies).toContain("USD");
    expect(currencies).toContain("EUR");
  });

  it("converts across differing currency scales", async () => {
    // USD (2 decimals) -> JPY (0). 10.00 USD at 150 is 1500 JPY.
    const jpyWallet = await seedAccount(db, tenant.orgId, "normal", "JPY Wallet", "JPY");

    await exchange({
      toAccountId: jpyWallet,
      amount: "10.00",
      rate: "150",
      targetAmount: "1500",
    });

    expect(await balanceOf(jpyWallet)).toBe("1500");
    expect((await accountNamed("FX Bridge JPY"))?.balance.amount).toBe("-1500");
  });
});

describe("the conversion has to add up", () => {
  it("rejects a target amount that does not match the rate, and says what it should be", async () => {
    // The error carries the expected figure so a form can show it. "Invalid
    // conversion" alone would leave someone guessing.
    await expect(exchange({ targetAmount: "91.00" })).rejects.toMatchObject({
      status: 422,
      data: { reason: "conversion_mismatch", expected: { amount: "92.00", currency: "EUR" } },
    });
  });

  it("accepts the correctly rounded result of a rate that does not divide evenly", async () => {
    // 33.33 x 0.92 = 30.6636 EUR, which EUR cannot hold exactly. Half-up gives
    // 30.66, and that is the only value accepted.
    await expect(
      exchange({ amount: "33.33", rate: "0.92", targetAmount: "30.66" }),
    ).resolves.toMatchObject({ rate: "0.92" });

    await expect(
      exchange({ amount: "33.33", rate: "0.92", targetAmount: "30.67" }),
    ).rejects.toMatchObject({ status: 422, data: { reason: "conversion_mismatch" } });
  });

  it("rejects a rate that is not a positive decimal", async () => {
    for (const rate of ["0", "-0.92", "abc", "1e5", ""]) {
      await expect(exchange({ rate }), `rate ${JSON.stringify(rate)}`).rejects.toMatchObject({
        status: expect.any(Number),
      });
    }
  });

  it("refuses an exchange between two accounts in the same currency", async () => {
    // Not an exchange. Accepting it would open a bridge pair in one currency and
    // post two transactions where `transactions.create` does one.
    const otherUsd = await seedAccount(db, tenant.orgId, "normal", "Other USD");

    await expect(
      exchange({ toAccountId: otherUsd, rate: "1", targetAmount: "100.00" }),
    ).rejects.toMatchObject({ status: 422, data: { reason: "same_currency_exchange" } });
  });

  it("records every refusal in the audit log", async () => {
    await expect(exchange({ targetAmount: "1.00" })).rejects.toThrow();

    const { entries } = await client().audit.rejections({ limit: 200 });
    expect(entries.map((entry) => entry.reason)).toContain("conversion_mismatch");
    expect(entries.map((entry) => entry.action)).toContain("post_exchange");
  });
});

describe("atomicity", () => {
  it("posts nothing at all when the source account cannot afford it", async () => {
    // The source leg fails, so the target leg must never have happened — and
    // crucially, no money may be left sitting in a bridge account with nothing
    // to say where it was going.
    const brokeWallet = await seedAccount(db, tenant.orgId, "normal", "Empty USD");

    await expect(
      exchange({ fromAccountId: brokeWallet, amount: "500.00", targetAmount: "460.00" }),
    ).rejects.toMatchObject({ status: 422, data: { reason: "insufficient_funds" } });

    expect(await balanceOf(brokeWallet)).toBe("0.00");
    expect(await balanceOf(eurWallet)).toBe("0.00");
    // No transaction of either currency was written.
    const { transactions } = await client().transactions.list({ limit: 200 });
    expect(transactions.filter((transaction) => transaction.currency === "EUR")).toHaveLength(0);
    for (const row of await reconcileAccounts(db, tenant.orgId)) {
      expect(row.reconciled).toBe(true);
    }
  });

  it("posts nothing when the target account does not exist", async () => {
    await expect(exchange({ toAccountId: randomUUID() })).rejects.toMatchObject({ status: 404 });

    expect(await balanceOf(usdWallet)).toBe("1000.00");
  });

  it("posts nothing when the target account belongs to another organization", async () => {
    // Reported as the same 404 as a missing id — nothing about another tenant's
    // data leaks, and no half-exchange is left behind.
    const other = await seedTenant(db, "OtherFx");
    const theirEur = await seedAccount(db, other.orgId, "normal", "Their EUR", "EUR");

    await expect(exchange({ toAccountId: theirEur })).rejects.toMatchObject({ status: 404 });

    expect(await balanceOf(usdWallet)).toBe("1000.00");
  });
});

describe("idempotency", () => {
  it("replays both legs for a repeated key, posting nothing twice", async () => {
    const key = randomUUID();

    const first = await exchange({ idempotencyKey: key });
    const replayed = await exchange({ idempotencyKey: key });

    expect(replayed.source.id).toBe(first.source.id);
    expect(replayed.target.id).toBe(first.target.id);

    // The balances moved once, not twice.
    expect(await balanceOf(usdWallet)).toBe("900.00");
    expect(await balanceOf(eurWallet)).toBe("92.00");
  });

  it("reports a conflict when the same key is reused with a different rate", async () => {
    // Same two amounts would be possible within a rounding band, so the rate is
    // part of the fingerprint: reusing a key with a different agreed rate is a
    // different request, and replaying the old one would silently discard the
    // new rate.
    const key = randomUUID();
    await exchange({ idempotencyKey: key, amount: "100.00", rate: "0.92", targetAmount: "92.00" });

    await expect(
      exchange({ idempotencyKey: key, amount: "100.00", rate: "0.9200", targetAmount: "92.00" }),
    ).rejects.toMatchObject({ status: 409, data: { reason: "idempotency_conflict" } });
  });

  it("reports a conflict when the same key is reused for a different direction", async () => {
    const key = randomUUID();
    await exchange({ idempotencyKey: key });

    // EUR -> USD with the same key. The two legs are hashed in source-then-target
    // order precisely so this cannot replay as if it were the same exchange.
    await expect(
      exchange({
        idempotencyKey: key,
        fromAccountId: eurWallet,
        toAccountId: usdWallet,
        amount: "92.00",
        rate: "1.0869565217",
        targetAmount: "100.00",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

/**
 * Reversing a leg of an exchange (open question #20).
 *
 * The property under test is that an exchange cannot be *half* undone. Before
 * this, `transactions.reverse` knew nothing about the FX link, so reversing the
 * USD half restored the payer and left the converted EUR with the payee and the
 * EUR bridge short — money simultaneously on the books and unreachable.
 */
describe("reversing one leg unwinds the whole exchange", () => {
  async function bridgeBalance(currency: string): Promise<string | undefined> {
    return (await accountNamed(`FX Bridge ${currency}`))?.balance.amount;
  }

  it("unwinds both legs when the source leg is named", async () => {
    const original = await exchange();

    await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.source.id,
    });

    // Every balance the exchange moved is back where it started, including
    // both halves of the FX position.
    expect(await balanceOf(usdWallet)).toBe("1000.00");
    expect(await balanceOf(eurWallet)).toBe("0.00");
    expect(await bridgeBalance("USD")).toBe("0.00");
    expect(await bridgeBalance("EUR")).toBe("0.00");

    // Both originals record a reversal — the half that was not named included.
    const source = await client().transactions.get({ transactionId: original.source.id });
    const target = await client().transactions.get({ transactionId: original.target.id });
    expect(source.reversedBy).toHaveLength(1);
    expect(target.reversedBy).toHaveLength(1);

    for (const row of await reconcileAccounts(db, tenant.orgId)) {
      expect(row.reconciled, `${row.accountName} drifted`).toBe(true);
    }
  });

  it("unwinds both legs when the target leg is named", async () => {
    const original = await exchange();

    await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.target.id,
    });

    expect(await balanceOf(usdWallet)).toBe("1000.00");
    expect(await balanceOf(eurWallet)).toBe("0.00");
    expect(await bridgeBalance("USD")).toBe("0.00");
    expect(await bridgeBalance("EUR")).toBe("0.00");

    const source = await client().transactions.get({ transactionId: original.source.id });
    expect(source.reversedBy).toHaveLength(1);
  });

  it("links the two reversals, so the returned one names its counterpart", async () => {
    const original = await exchange();

    // The caller named the source leg, so the source leg's mirror comes back.
    // This is what lets the response stay a single `postedTransactionSchema`:
    // the unwind pair is fx-linked like the exchange it undoes, so the one
    // transaction returned already points at the other.
    const unwound = await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.source.id,
    });

    expect(unwound.reversesTransactionId).toBe(original.source.id);
    expect(unwound.fxTargetTransactionId).not.toBeNull();

    const counterpart = await client().transactions.get({
      transactionId: unwound.fxTargetTransactionId ?? "",
    });
    expect(counterpart.reversesTransactionId).toBe(original.target.id);
    expect(counterpart.currency).toBe("EUR");
    // The unwind carries the rate it undoes, not its inverse: that rate is what
    // relates its own two amounts, and 1/0.92 is not exactly representable.
    expect(counterpart.fxRate).toBe("0.92");
  });

  it("replays the whole unwind for a repeated key, posting nothing twice", async () => {
    const original = await exchange();
    const key = randomUUID();

    const first = await client().transactions.reverse({
      idempotencyKey: key,
      transactionId: original.source.id,
    });
    const replayed = await client().transactions.reverse({
      idempotencyKey: key,
      transactionId: original.source.id,
    });

    expect(replayed.id).toBe(first.id);
    expect(replayed.replayed).toBe(true);
    expect(await balanceOf(usdWallet)).toBe("1000.00");
    expect(await balanceOf(eurWallet)).toBe("0.00");
  });

  it("does not replay one exchange's unwind against an identical exchange", async () => {
    // Two identical exchanges produce byte-identical mirror legs, so without
    // the reversed ids in the fingerprint this key would replay the first
    // unwind and report success while the second exchange stayed standing.
    const first = await exchange();
    const second = await exchange();
    const key = randomUUID();

    await client().transactions.reverse({ idempotencyKey: key, transactionId: first.source.id });

    await expect(
      client().transactions.reverse({ idempotencyKey: key, transactionId: second.source.id }),
    ).rejects.toMatchObject({ status: 409, data: { reason: "idempotency_conflict" } });

    // The second exchange is untouched, which is the whole point of the refusal.
    const stillStanding = await client().transactions.get({ transactionId: second.source.id });
    expect(stillStanding.reversedBy).toHaveLength(0);
  });

  it("refuses the entire unwind when the payee has spent the proceeds", async () => {
    const original = await exchange();

    // The 92.00 EUR leaves before anyone tries to unwind the exchange.
    const eurSink = await seedAccount(db, tenant.orgId, "external", "EUR Sink", "EUR");
    await postTransaction(db, {
      orgId: tenant.orgId,
      actorId: tenant.userId,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      transaction: buildTransfer(eurWallet, eurSink, "92.00", "EUR"),
    });

    await expect(
      client().transactions.reverse({
        idempotencyKey: randomUUID(),
        transactionId: original.source.id,
      }),
    ).rejects.toMatchObject({ status: 422, data: { reason: "insufficient_funds" } });

    // Neither leg posted — including the USD one, which on its own would have
    // succeeded. Half an unwind is the outcome this exists to prevent.
    expect(await balanceOf(usdWallet)).toBe("900.00");
    expect(await bridgeBalance("USD")).toBe("100.00");
    expect(await bridgeBalance("EUR")).toBe("-92.00");
    const source = await client().transactions.get({ transactionId: original.source.id });
    expect(source.reversedBy).toHaveLength(0);
  });

  it("refuses a second unwind of the same exchange", async () => {
    const original = await exchange();
    await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.source.id,
    });

    await expect(
      client().transactions.reverse({
        idempotencyKey: randomUUID(),
        transactionId: original.source.id,
      }),
    ).rejects.toMatchObject({ status: 409, data: { reason: "already_reversed" } });

    expect(await balanceOf(usdWallet)).toBe("1000.00");
  });

  it("unwinds the survivor alone when the counterpart was already reversed", async () => {
    // A half-reversed exchange is no longer reachable through the API, but it
    // can already exist in data written before this behaviour. Taking the pair
    // path there would hit the unique index on `reverses_transaction_id`, roll
    // back, and strand the survivor permanently — worse than the bug being
    // fixed — so the remaining leg is reversed on its own.
    const original = await exchange();
    const eurBridge = await accountNamed("FX Bridge EUR");
    expect(eurBridge).toBeDefined();

    await postTransaction(db, {
      orgId: tenant.orgId,
      actorId: tenant.userId,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      transaction: buildTransfer(eurWallet, eurBridge?.id ?? "", "92.00", "EUR"),
      reversesTransactionId: original.target.id,
    });

    await client().transactions.reverse({
      idempotencyKey: randomUUID(),
      transactionId: original.source.id,
    });

    expect(await balanceOf(usdWallet)).toBe("1000.00");
    expect(await balanceOf(eurWallet)).toBe("0.00");
    expect(await bridgeBalance("USD")).toBe("0.00");
    expect(await bridgeBalance("EUR")).toBe("0.00");
    for (const row of await reconcileAccounts(db, tenant.orgId)) {
      expect(row.reconciled, `${row.accountName} drifted`).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("refuses a viewer", async () => {
    const viewer = await seedTenant(db, "FxViewer", "member");
    const theirUsd = await seedAccount(db, viewer.orgId, "normal", "V USD");
    const theirEur = await seedAccount(db, viewer.orgId, "normal", "V EUR", "EUR");

    await expect(
      clientFor(db, sessionFor(viewer)).transactions.exchange({
        idempotencyKey: randomUUID(),
        fromAccountId: theirUsd,
        toAccountId: theirEur,
        amount: "1.00",
        rate: "0.92",
        targetAmount: "0.92",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
