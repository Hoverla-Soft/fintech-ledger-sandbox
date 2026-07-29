import { describe, expect, it } from "vitest";

import type { WireAccount } from "@/features/accounts/account-display";

import {
  canExchange,
  exchangeDestinations,
  exchangeSources,
  isFxBridge,
  previewConversion,
} from "./conversion";

function account(overrides: Partial<WireAccount> & { id: string }): WireAccount {
  return {
    name: `Account ${overrides.id}`,
    currency: "USD",
    type: "normal",
    balance: { amount: "0.00", currency: overrides.currency ?? "USD" },
    active: true,
    createdAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

const usd = account({ id: "usd", currency: "USD", name: "USD Wallet" });
const eur = account({ id: "eur", currency: "EUR", name: "EUR Wallet" });
const jpy = account({ id: "jpy", currency: "JPY", name: "JPY Wallet" });

describe("previewConversion", () => {
  it("computes the target amount the server will accept", () => {
    expect(previewConversion(usd, eur, "100.00", "0.92")).toEqual({
      ok: true,
      targetAmount: "92.00",
      targetCurrency: "EUR",
    });
  });

  it("rounds half-up at the target currency's scale, matching the server exactly", () => {
    // 33.33 x 0.92 = 30.6636 EUR. If the console rounded differently from
    // `packages/core`'s `convert`, this form would submit a figure the server
    // then rejects — with no way for the user to tell which side is wrong.
    expect(previewConversion(usd, eur, "33.33", "0.92")).toMatchObject({
      ok: true,
      targetAmount: "30.66",
    });
  });

  it("renders a zero-exponent target with no decimal point", () => {
    expect(previewConversion(usd, jpy, "10.00", "150")).toMatchObject({
      ok: true,
      targetAmount: "1500",
    });
  });

  it("is exact where a float would not be", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; the whole conversion path is
    // integer minor units, so this lands on the cent.
    expect(previewConversion(usd, eur, "0.30", "1")).toMatchObject({
      ok: true,
      targetAmount: "0.30",
    });
  });

  it("reports what is still missing rather than guessing", () => {
    expect(previewConversion(null, eur, "10.00", "0.92")).toEqual({
      ok: false,
      problem: "no-source",
    });
    expect(previewConversion(usd, null, "10.00", "0.92")).toEqual({
      ok: false,
      problem: "no-target",
    });
    expect(previewConversion(usd, eur, "", "0.92")).toEqual({
      ok: false,
      problem: "invalid-amount",
    });
    expect(previewConversion(usd, eur, "10.00", "")).toEqual({
      ok: false,
      problem: "invalid-rate",
    });
  });

  it("refuses a same-currency pair instead of quietly treating it as a transfer", () => {
    const otherUsd = account({ id: "usd2", currency: "USD", name: "Other USD" });

    expect(previewConversion(usd, otherUsd, "10.00", "1")).toEqual({
      ok: false,
      problem: "same-currency",
    });
  });

  it("rejects an amount with more precision than the source currency holds", () => {
    // Excess precision is an error, never rounded — the same rule the amount
    // parser applies everywhere else (ADR 0002).
    expect(previewConversion(usd, eur, "10.005", "0.92")).toEqual({
      ok: false,
      problem: "invalid-amount",
    });
  });

  it("rejects a zero or negative rate", () => {
    expect(previewConversion(usd, eur, "10.00", "0")).toEqual({
      ok: false,
      problem: "invalid-rate",
    });
    expect(previewConversion(usd, eur, "10.00", "-0.92")).toEqual({
      ok: false,
      problem: "invalid-rate",
    });
  });

  it("rejects an unknown currency rather than guessing a scale", () => {
    const mystery = account({ id: "xxx", currency: "XXX", name: "Mystery" });

    expect(previewConversion(usd, mystery, "10.00", "0.92")).toEqual({
      ok: false,
      problem: "unsupported-currency",
    });
  });
});

describe("eligibility", () => {
  it("offers only accounts in a different currency as destinations", () => {
    const otherUsd = account({ id: "usd2", currency: "USD" });

    expect(exchangeDestinations([usd, otherUsd, eur, jpy], usd).map((a) => a.id)).toEqual([
      "eur",
      "jpy",
    ]);
  });

  it("excludes the source itself, and inactive accounts", () => {
    const closedEur = account({ id: "eur-closed", currency: "EUR", active: false });

    expect(exchangeDestinations([usd, eur, closedEur], usd).map((a) => a.id)).toEqual(["eur"]);
  });

  it("excludes FX bridge accounts from both pickers", () => {
    // Bridges are opened automatically to hold the offsetting position.
    // Exchanging directly into one would work and mean nothing — it is plumbing,
    // not a destination anybody intends.
    const bridge = account({ id: "bridge", currency: "EUR", name: "FX Bridge EUR" });

    expect(exchangeDestinations([eur, bridge], usd).map((a) => a.id)).toEqual(["eur"]);
    expect(exchangeSources([usd, bridge]).map((a) => a.id)).toEqual(["usd"]);
  });

  it("returns nothing when no source is chosen yet", () => {
    expect(exchangeDestinations([usd, eur], null)).toEqual([]);
  });
});

describe("canExchange", () => {
  it("needs two active accounts in different currencies", () => {
    // The mirror of `canTransfer`, which needs two in the *same* currency. An
    // org with two USD accounts can transfer and cannot exchange; one USD plus
    // one EUR is the reverse. Each empty state has to say the true one.
    expect(canExchange([usd, eur])).toBe(true);
    expect(canExchange([usd, account({ id: "usd2", currency: "USD" })])).toBe(false);
    expect(canExchange([usd])).toBe(false);
    expect(canExchange([])).toBe(false);
  });

  it("ignores inactive accounts and bridges", () => {
    expect(canExchange([usd, account({ id: "eur2", currency: "EUR", active: false })])).toBe(false);
    expect(
      canExchange([usd, account({ id: "bridge", currency: "EUR", name: "FX Bridge EUR" })]),
    ).toBe(false);
  });
});

describe("isFxBridge", () => {
  it("matches the server's naming and nothing near it", () => {
    expect(isFxBridge(account({ id: "a", name: "FX Bridge USD" }))).toBe(true);
    // Not a bridge: an ordinary account whose name merely starts similarly.
    expect(isFxBridge(account({ id: "b", name: "FX Bridgehead" }))).toBe(false);
    expect(isFxBridge(account({ id: "c", name: "My FX Bridge USD" }))).toBe(false);
    expect(isFxBridge(account({ id: "d", name: "USD Wallet" }))).toBe(false);
  });
});
