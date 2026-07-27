import { describe, expect, it } from "vitest";
import type { Currency } from "../money/currency";
import { Money } from "../money/money";
import type { Result } from "../result";
import type { Account, AccountType } from "./account";
import { applyDelta } from "./account";

function unwrapOk<T, E>(result: Result<T, E>, label: string): T {
  if (!result.ok) {
    throw new Error(`expected ok for ${label}`);
  }
  return result.value;
}

function unwrapErr<T, E>(result: Result<T, E>, label: string): E {
  if (result.ok) {
    throw new Error(`expected error for ${label}`);
  }
  return result.error;
}

function usd(minorUnits: bigint): Money {
  return unwrapOk(Money.ofMinorUnits(minorUnits, "USD"), `${minorUnits} USD`);
}

function eur(minorUnits: bigint): Money {
  return unwrapOk(Money.ofMinorUnits(minorUnits, "EUR"), `${minorUnits} EUR`);
}

function account(type: AccountType, currency: Currency = "USD"): Account {
  return { id: "acct-1", orgId: "org-1", currency, type };
}

describe("applyDelta — normal account funds rule", () => {
  it("accepts a delta that keeps the balance positive", () => {
    const result = unwrapOk(applyDelta(account("normal"), usd(100n), usd(50n)), "positive delta");
    expect(result.minorUnits).toBe(150n);
  });

  it("rejects a delta that would drive the balance below zero", () => {
    const error = unwrapErr(applyDelta(account("normal"), usd(50n), usd(-60n)), "below zero");
    if (error.kind !== "InsufficientFunds") {
      throw new Error("expected InsufficientFunds");
    }
    expect(error.accountId).toBe("acct-1");
    expect(error.resulting.minorUnits).toBe(-10n);
    expect(error.resulting.isNegative()).toBe(true);
  });

  it("accepts a delta that lands exactly at zero — boundary, zero is not negative", () => {
    const result = unwrapOk(applyDelta(account("normal"), usd(50n), usd(-50n)), "exactly zero");
    expect(result.minorUnits).toBe(0n);
    expect(result.isZero()).toBe(true);
  });
});

describe("applyDelta — external account", () => {
  it("accepts the same negative-driving delta a normal account would reject", () => {
    const result = unwrapOk(applyDelta(account("external"), usd(50n), usd(-60n)), "external below zero");
    expect(result.minorUnits).toBe(-10n);
  });
});

describe("applyDelta — currency check runs before the funds rule", () => {
  it("returns CurrencyMismatch, not InsufficientFunds, when the balance currency disagrees with the account", () => {
    const error = unwrapErr(applyDelta(account("normal"), eur(5n), usd(-1000n)), "balance currency mismatch");
    expect(error).toEqual({ kind: "CurrencyMismatch", expected: "USD", actual: "EUR" });
  });

  it("returns CurrencyMismatch, not InsufficientFunds, when the delta currency disagrees with the account", () => {
    const error = unwrapErr(applyDelta(account("normal"), usd(5n), eur(-1000n)), "delta currency mismatch");
    expect(error).toEqual({ kind: "CurrencyMismatch", expected: "USD", actual: "EUR" });
  });
});
