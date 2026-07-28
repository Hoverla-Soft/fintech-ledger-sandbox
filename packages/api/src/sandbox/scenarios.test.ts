import { Money, type Result } from "@fintech-ledger-sandbox/core";
import { describe, expect, it } from "vitest";

import { SEED_ACCOUNTS, SEED_CURRENCY, SEED_SCENARIOS, scenarioKeys, type SeedScenario } from "./scenarios";

/**
 * The seed set, checked as data.
 *
 * Every property here would otherwise only be observable by running the seed
 * against Postgres and reading balances back — at which point a malformed
 * scenario surfaces as a confusing `422` from deep inside the handler rather
 * than as a failing assertion naming the scenario.
 */

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Debit-positive, matching `core.signedAmount` — a valid transaction's legs sum to zero. */
function signedSum(scenario: SeedScenario): bigint {
  return scenario.legs.reduce((total, leg) => {
    const amount = unwrap(Money.parse(leg.amount, SEED_CURRENCY)).minorUnits;
    return total + (leg.direction === "debit" ? amount : -amount);
  }, 0n);
}

const accountNames = new Set(SEED_ACCOUNTS.map((account) => account.name));

describe("seed accounts", () => {
  it("declares unique names, since (org_id, name) is unique", () => {
    expect(accountNames.size).toBe(SEED_ACCOUNTS.length);
  });

  it("provides exactly one external account for money to enter through", () => {
    const external = SEED_ACCOUNTS.filter((account) => account.type === "external");

    expect(external.map((account) => account.name)).toEqual(["Sandbox Funding"]);
  });

  it("is single-currency, so no scenario can violate invariant #7", () => {
    for (const account of SEED_ACCOUNTS) {
      expect(account.currency).toBe(SEED_CURRENCY);
    }
  });
});

describe("seed scenarios", () => {
  it("covers the four scenarios ledger.md's acceptance criteria name", () => {
    const ids = SEED_SCENARIOS.map((scenario) => scenario.id);

    expect(ids).toContain("payroll");
    expect(ids).toContain("marketplace_payout");
    expect(ids).toContain("insufficient_funds");
    expect(ids).toContain("reversal");
  });

  it("declares unique ids, since idempotency keys are derived from them", () => {
    const ids = SEED_SCENARIOS.map((scenario) => scenario.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("funds the sandbox before anything tries to move money", () => {
    expect(SEED_SCENARIOS[0]?.id).toBe("funding");
  });

  it.each(SEED_SCENARIOS)("$id names only accounts the seed declares", (scenario) => {
    for (const leg of scenario.legs) {
      expect(accountNames).toContain(leg.accountName);
    }
  });

  it.each(SEED_SCENARIOS)("$id has at least two legs", (scenario) => {
    expect(scenario.legs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(SEED_SCENARIOS)("$id has legs that net to zero", (scenario) => {
    // True even of the rejected scenario: it is refused for insufficient
    // funds, which is a balance rule — it must still be a *balanced*
    // transaction, or it would be rejected at construction for the wrong
    // reason and never reach the funds check at all.
    expect(signedSum(scenario)).toBe(0n);
  });

  it.each(SEED_SCENARIOS)("$id uses only positive, parseable amounts", (scenario) => {
    for (const leg of scenario.legs) {
      const amount = unwrap(Money.parse(leg.amount, SEED_CURRENCY));
      expect(amount.isPositive()).toBe(true);
    }
  });

  it("expects exactly one rejection, and it is the insufficient-funds case", () => {
    const rejected = SEED_SCENARIOS.filter((scenario) => scenario.expect === "rejected");

    expect(rejected.map((scenario) => scenario.id)).toEqual(["insufficient_funds"]);
  });

  it("drives Employee A below zero in the rejected scenario, which is why it is refused", () => {
    const payrollCredit = SEED_SCENARIOS.find((scenario) => scenario.id === "payroll")
      ?.legs.find((leg) => leg.accountName === "Employee A");
    const attempt = SEED_SCENARIOS.find((scenario) => scenario.id === "insufficient_funds")
      ?.legs.find((leg) => leg.accountName === "Employee A");

    expect(payrollCredit?.direction).toBe("debit");
    expect(attempt?.direction).toBe("credit");

    const funded = unwrap(Money.parse(payrollCredit?.amount ?? "0", SEED_CURRENCY)).minorUnits;
    const withdrawn = unwrap(Money.parse(attempt?.amount ?? "0", SEED_CURRENCY)).minorUnits;

    expect(withdrawn).toBeGreaterThan(funded);
  });

  it("reverses exactly one scenario", () => {
    const reversing = SEED_SCENARIOS.filter((scenario) => scenario.reverseAfterPost);

    expect(reversing.map((scenario) => scenario.id)).toEqual(["reversal"]);
  });
});

describe("scenarioKeys", () => {
  it("gives a reversing scenario two distinct keys, since it posts two transactions", () => {
    const reversal = SEED_SCENARIOS.find((scenario) => scenario.id === "reversal") as SeedScenario;
    const keys = scenarioKeys("run-a", reversal);

    expect(keys.post).not.toBe(keys.reversal);
  });

  it("produces a key unique to every transaction the seed posts", () => {
    const keys = SEED_SCENARIOS.flatMap((scenario) => {
      const derived = scenarioKeys("run-a", scenario);
      return scenario.reverseAfterPost ? [derived.post, derived.reversal] : [derived.post];
    });

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("separates two runs entirely, so a fresh run key seeds again rather than replaying", () => {
    const scenario = SEED_SCENARIOS[0] as SeedScenario;

    expect(scenarioKeys("run-a", scenario).post).not.toBe(scenarioKeys("run-b", scenario).post);
  });
});
