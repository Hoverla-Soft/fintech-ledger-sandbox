import { SEED_SCENARIOS } from "@fintech-ledger-sandbox/api/sandbox/scenarios";
import { describe, expect, it } from "vitest";

import { parseAmount } from "./amount";
import {
  assertBalanced,
  composeLegs,
  composeTransfer,
  type LegIntent,
  MAX_POSTINGS,
  type PostingInput,
} from "./postings";

/**
 * The `funding` scenario is the orientation ground truth.
 *
 * It is not a fixture written for this test — it is the payload
 * `packages/api`'s own integration suite posts against a real Postgres and
 * asserts succeeds (`packages/api/src/routers/sandbox.test.ts`). If anyone
 * ever flips its directions, this test fails, which is exactly what should
 * happen: the console's idea of which way money flows must not be able to
 * drift from the server's.
 *
 * Imported rather than copied. `scenarios.ts`'s only import is an `import
 * type`, so this pulls in no runtime dependency and no database.
 */
const FUNDING = SEED_SCENARIOS.find((scenario) => scenario.id === "funding");

describe("orientation — the failure the server cannot catch", () => {
  it("has the funding scenario available as ground truth", () => {
    expect(FUNDING).toBeDefined();
  });

  it("debits the destination and credits the source, matching the funding scenario", () => {
    if (FUNDING === undefined) {
      throw new Error("funding scenario missing");
    }

    // Read the truth out of the fixture instead of restating it, so this
    // test cannot agree with a stale copy of the convention.
    const debitLeg = FUNDING.legs.find((leg) => leg.direction === "debit");
    const creditLeg = FUNDING.legs.find((leg) => leg.direction === "credit");
    expect(debitLeg).toBeDefined();
    expect(creditLeg).toBeDefined();
    if (debitLeg === undefined || creditLeg === undefined) {
      throw new Error("funding scenario is not a two-sided transfer");
    }

    // Money enters the sandbox: it leaves the external boundary account and
    // arrives in the operating account. So the *arriving* account is the one
    // the fixture debits, and the *departing* account is the one it credits.
    expect(debitLeg.accountName).toBe("Operating");
    expect(creditLeg.accountName).toBe("Sandbox Funding");

    const parsed = parseAmount(debitLeg.amount, "USD");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("funding amount did not parse");
    }

    const composed = composeTransfer({
      sourceAccountId: creditLeg.accountName,
      destinationAccountId: debitLeg.accountName,
      minorUnits: parsed.minorUnits,
      currency: "USD",
    });

    expect(composed.ok).toBe(true);
    if (!composed.ok) {
      throw new Error("composition failed");
    }

    expect(composed.postings).toEqual([
      { accountId: "Operating", direction: "debit", amount: "5000.00", currency: "USD" },
      { accountId: "Sandbox Funding", direction: "credit", amount: "5000.00", currency: "USD" },
    ]);
  });

  it("produces a DIFFERENT array when source and destination are swapped", () => {
    // Without this, every other assertion in this file is satisfied by a
    // backwards transfer: an inverted array still nets to zero, still posts,
    // and still reconciles. It just moves the money the wrong way, and no
    // layer below the console would object.
    const forward = composeTransfer({
      sourceAccountId: "a",
      destinationAccountId: "b",
      minorUnits: 100n,
      currency: "USD",
    });
    const backward = composeTransfer({
      sourceAccountId: "b",
      destinationAccountId: "a",
      minorUnits: 100n,
      currency: "USD",
    });

    expect(forward.ok && backward.ok).toBe(true);
    if (!forward.ok || !backward.ok) {
      throw new Error("composition failed");
    }
    expect(forward.postings).not.toEqual(backward.postings);

    // And specifically: the account debited in one is credited in the other.
    expect(forward.postings[0]?.accountId).toBe("b");
    expect(backward.postings[0]?.accountId).toBe("a");
  });

  it("agrees with every posted multi-leg seed scenario on which side carries which direction", () => {
    // payroll and marketplace_payout both credit the account money leaves
    // (Operating) and debit the accounts it arrives in.
    for (const id of ["payroll", "marketplace_payout"]) {
      const scenario = SEED_SCENARIOS.find((candidate) => candidate.id === id);
      expect(scenario).toBeDefined();
      if (scenario === undefined) {
        continue;
      }
      const credits = scenario.legs.filter((leg) => leg.direction === "credit");
      expect(credits).toHaveLength(1);
      expect(credits[0]?.accountName).toBe("Operating");
    }
  });
});

describe("composeTransfer", () => {
  it("builds two legs of equal amount in the stated currency", () => {
    const composed = composeTransfer({
      sourceAccountId: "src",
      destinationAccountId: "dst",
      minorUnits: 1250n,
      currency: "USD",
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) {
      throw new Error("composition failed");
    }
    expect(composed.postings).toHaveLength(2);
    expect(composed.postings.every((posting) => posting.amount === "12.50")).toBe(true);
    expect(assertBalanced(composed.postings)).toBe(true);
  });

  it("scales the amount to the currency, not to a fixed two decimal places", () => {
    const jpy = composeTransfer({
      sourceAccountId: "src",
      destinationAccountId: "dst",
      minorUnits: 1250n,
      currency: "JPY",
    });
    if (!jpy.ok) {
      throw new Error("composition failed");
    }
    // 1250 minor units of JPY is 1250 yen, not 12.50.
    expect(jpy.postings[0]?.amount).toBe("1250");

    const bhd = composeTransfer({
      sourceAccountId: "src",
      destinationAccountId: "dst",
      minorUnits: 1250n,
      currency: "BHD",
    });
    if (!bhd.ok) {
      throw new Error("composition failed");
    }
    expect(bhd.postings[0]?.amount).toBe("1.250");
  });

  it("rejects a non-positive amount", () => {
    expect(
      composeTransfer({
        sourceAccountId: "a",
        destinationAccountId: "b",
        minorUnits: 0n,
        currency: "USD",
      }),
    ).toEqual({ ok: false, problem: "non_positive_amount" });
    expect(
      composeTransfer({
        sourceAccountId: "a",
        destinationAccountId: "b",
        minorUnits: -1n,
        currency: "USD",
      }),
    ).toEqual({ ok: false, problem: "non_positive_amount" });
  });

  it("rejects a transfer to the same account, which would net to zero against itself", () => {
    expect(
      composeTransfer({
        sourceAccountId: "a",
        destinationAccountId: "a",
        minorUnits: 100n,
        currency: "USD",
      }),
    ).toEqual({ ok: false, problem: "same_account" });
  });

  it("rejects an unknown currency instead of emitting a non-decimal wire amount", () => {
    // Regression. `formatMinorUnits` refuses to guess a scale it does not know
    // and returns "100 XXX" — fine for display, but as a wire `amount` it is
    // not a decimal string. This used to return ok:true carrying that value,
    // and the failure surfaced only as a thrown assertBalanced rather than a
    // typed rejection a form could render inline.
    const composed = composeTransfer({
      sourceAccountId: "a",
      destinationAccountId: "b",
      minorUnits: 100n,
      currency: "XXX",
    });
    expect(composed).toEqual({ ok: false, problem: "unsupported_currency" });
  });
});

describe("composeLegs", () => {
  it("accepts a balanced N-leg split", () => {
    const legs: LegIntent[] = [
      { accountId: "seller", direction: "debit", minorUnits: 95000n },
      { accountId: "fees", direction: "debit", minorUnits: 5000n },
      { accountId: "operating", direction: "credit", minorUnits: 100000n },
    ];
    const composed = composeLegs(legs, "USD");
    expect(composed.ok).toBe(true);
    if (!composed.ok) {
      throw new Error("composition failed");
    }
    expect(assertBalanced(composed.postings)).toBe(true);
  });

  it("rejects an unbalanced split rather than sending it", () => {
    const legs: LegIntent[] = [
      { accountId: "a", direction: "debit", minorUnits: 100n },
      { accountId: "b", direction: "credit", minorUnits: 99n },
    ];
    expect(composeLegs(legs, "USD")).toEqual({ ok: false, problem: "unbalanced" });
  });

  it("rejects fewer than two legs", () => {
    expect(composeLegs([{ accountId: "a", direction: "debit", minorUnits: 1n }], "USD")).toEqual({
      ok: false,
      problem: "too_few_postings",
    });
    expect(composeLegs([], "USD")).toEqual({ ok: false, problem: "too_few_postings" });
  });

  it("accepts exactly MAX_POSTINGS legs and rejects one more", () => {
    const build = (count: number): LegIntent[] => {
      const debits = Array.from({ length: count - 1 }, (_, index) => ({
        accountId: `debit-${index}`,
        direction: "debit" as const,
        minorUnits: 100n,
      }));
      return [
        ...debits,
        { accountId: "credit", direction: "credit" as const, minorUnits: BigInt(count - 1) * 100n },
      ];
    };

    expect(composeLegs(build(MAX_POSTINGS), "USD").ok).toBe(true);
    expect(composeLegs(build(MAX_POSTINGS + 1), "USD")).toEqual({
      ok: false,
      problem: "too_many_postings",
    });
  });

  it("rejects an unknown currency before formatting any leg", () => {
    const legs: LegIntent[] = [
      { accountId: "a", direction: "debit", minorUnits: 100n },
      { accountId: "b", direction: "credit", minorUnits: 100n },
    ];
    expect(composeLegs(legs, "XXX")).toEqual({ ok: false, problem: "unsupported_currency" });
  });

  it("rejects a non-positive leg — direction carries the sign, never the amount", () => {
    const legs: LegIntent[] = [
      { accountId: "a", direction: "debit", minorUnits: 100n },
      { accountId: "b", direction: "credit", minorUnits: 0n },
    ];
    expect(composeLegs(legs, "USD")).toEqual({ ok: false, problem: "non_positive_amount" });
  });

  it("nets to exactly zero across randomised splits for every leg count from 2 to MAX_POSTINGS", () => {
    // Deterministic PRNG — a seeded sequence, so a failure is reproducible
    // rather than a flake nobody can chase.
    let seed = 0x5eed;
    const nextInt = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % bound) + 1;
    };

    for (let legCount = 2; legCount <= MAX_POSTINGS; legCount += 1) {
      const debitCount = legCount - 1;
      const debits = Array.from({ length: debitCount }, (_, index) => ({
        accountId: `debit-${index}`,
        direction: "debit" as const,
        minorUnits: BigInt(nextInt(100_000)),
      }));
      const total = debits.reduce((sum, leg) => sum + leg.minorUnits, 0n);
      const legs: LegIntent[] = [
        ...debits,
        { accountId: "credit", direction: "credit", minorUnits: total },
      ];

      const composed = composeLegs(legs, "USD");
      expect(composed.ok).toBe(true);
      if (!composed.ok) {
        throw new Error(`composition failed at ${legCount} legs`);
      }
      expect(assertBalanced(composed.postings)).toBe(true);
    }
  });
});

describe("assertBalanced — the last line before a send", () => {
  const posting = (
    accountId: string,
    direction: "debit" | "credit",
    amount: string,
    currency = "USD",
  ): PostingInput => ({ accountId, direction, amount, currency });

  it("throws on an unbalanced array", () => {
    expect(() =>
      assertBalanced([posting("a", "debit", "1.00"), posting("b", "credit", "0.99")]),
    ).toThrow(/unbalanced/i);
  });

  it("throws when two legs are scaled differently — the false-pass case", () => {
    // "1.0" and "10" both reduce to the digits `10`. A check that ignored
    // scale would cancel them and wave through a transfer that moves nine
    // units of real money.
    expect(() =>
      assertBalanced([posting("a", "debit", "1.0"), posting("b", "credit", "10")]),
    ).toThrow(/unbalanced/i);
  });

  it("accepts legs written at different widths when they genuinely agree", () => {
    expect(assertBalanced([posting("a", "debit", "1.0"), posting("b", "credit", "1.00")])).toBe(
      true,
    );
  });

  it("throws on fewer than two legs or more than MAX_POSTINGS", () => {
    expect(() => assertBalanced([posting("a", "debit", "1.00")])).toThrow(/at least/i);

    const tooMany = Array.from({ length: MAX_POSTINGS + 1 }, (_, index) =>
      posting(`a-${index}`, index === 0 ? "credit" : "debit", "1.00"),
    );
    expect(() => assertBalanced(tooMany)).toThrow(/at most/i);
  });

  it("throws when legs span more than one currency", () => {
    expect(() =>
      assertBalanced([posting("a", "debit", "1.00", "USD"), posting("b", "credit", "1.00", "EUR")]),
    ).toThrow(/currencies/i);
  });

  it("throws rather than silently accepting an amount that is not a decimal string", () => {
    expect(() =>
      assertBalanced([posting("a", "debit", "abc"), posting("b", "credit", "abc")]),
    ).toThrow(/decimal string/i);
  });
});
