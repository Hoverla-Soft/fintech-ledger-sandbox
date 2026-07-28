import { describe, expect, it } from "vitest";

import type { WireAccount } from "@/features/accounts/account-display";

import { canTransfer, eligibleDestinations, eligibleSources } from "./eligibility";

function account(overrides: Partial<WireAccount> = {}): WireAccount {
  return {
    id: "acc-1",
    name: "Operating",
    currency: "USD",
    type: "normal",
    balance: { amount: "0.00", currency: "USD" },
    active: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("eligibleSources", () => {
  it("excludes closed accounts, pre-empting 422 account_inactive", () => {
    const accounts = [account({ id: "a" }), account({ id: "b", active: false })];
    expect(eligibleSources(accounts).map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("eligibleDestinations", () => {
  const usd = account({ id: "usd-1", currency: "USD" });

  it("is empty until a source is chosen — direction is chosen before destination", () => {
    expect(eligibleDestinations([usd], null)).toEqual([]);
  });

  it("excludes a different currency, pre-empting 422 currency_mismatch", () => {
    // Invariant #7: every posting in a transaction shares one currency, and
    // this sandbox does not convert between them.
    const accounts = [
      usd,
      account({ id: "usd-2", currency: "USD" }),
      account({ id: "jpy-1", currency: "JPY" }),
    ];
    expect(eligibleDestinations(accounts, usd).map((entry) => entry.id)).toEqual(["usd-2"]);
  });

  it("excludes the source itself, which would net to zero against its own account", () => {
    const accounts = [usd, account({ id: "usd-2", currency: "USD" })];
    expect(eligibleDestinations(accounts, usd).map((entry) => entry.id)).not.toContain("usd-1");
  });

  it("excludes closed accounts", () => {
    const accounts = [usd, account({ id: "usd-2", currency: "USD", active: false })];
    expect(eligibleDestinations(accounts, usd)).toEqual([]);
  });

  it("allows an external destination — money leaving the sandbox is a normal transfer", () => {
    const accounts = [usd, account({ id: "ext", currency: "USD", type: "external" })];
    expect(eligibleDestinations(accounts, usd).map((entry) => entry.id)).toEqual(["ext"]);
  });
});

describe("canTransfer", () => {
  it("is false with no accounts", () => {
    expect(canTransfer([])).toBe(false);
  });

  it("is false with a single account", () => {
    expect(canTransfer([account()])).toBe(false);
  });

  it("is false with two accounts in DIFFERENT currencies", () => {
    // The case a naive `length >= 2` check gets wrong: the org has two
    // accounts and can still transfer nothing, so the empty state must not
    // tell the user to go create an account they already have.
    const accounts = [account({ id: "a", currency: "USD" }), account({ id: "b", currency: "JPY" })];
    expect(canTransfer(accounts)).toBe(false);
  });

  it("is true with two active accounts sharing a currency", () => {
    const accounts = [account({ id: "a" }), account({ id: "b" })];
    expect(canTransfer(accounts)).toBe(true);
  });

  it("ignores closed accounts when deciding", () => {
    const accounts = [account({ id: "a" }), account({ id: "b", active: false })];
    expect(canTransfer(accounts)).toBe(false);
  });
});
