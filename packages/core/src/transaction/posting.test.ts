import { describe, expect, it } from "vitest";
import { Money } from "../money/money";
import type { Result } from "../result";
import { createPosting, signedAmount } from "./posting";

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

describe("createPosting", () => {
  it("accepts a strictly positive amount", () => {
    const amount = unwrapOk(Money.ofMinorUnits(500n, "USD"), "5.00 USD");
    const posting = unwrapOk(createPosting("acct-1", "debit", amount), "positive posting");
    expect(posting).toEqual({ accountId: "acct-1", direction: "debit", amount });
  });

  it("rejects a zero amount with NonPositiveAmount", () => {
    const amount = unwrapOk(Money.ofMinorUnits(0n, "USD"), "0 USD");
    const error = unwrapErr(createPosting("acct-1", "credit", amount), "zero posting");
    expect(error).toEqual({ kind: "NonPositiveAmount", amount });
  });

  it("rejects a negative amount with NonPositiveAmount", () => {
    const amount = unwrapOk(Money.ofMinorUnits(-100n, "USD"), "-1.00 USD");
    const error = unwrapErr(createPosting("acct-1", "debit", amount), "negative posting");
    expect(error).toEqual({ kind: "NonPositiveAmount", amount });
  });
});

describe("signedAmount — the sign convention packages/db depends on", () => {
  it("is positive for a debit", () => {
    const amount = unwrapOk(Money.ofMinorUnits(500n, "USD"), "5.00 USD");
    const posting = unwrapOk(createPosting("acct-1", "debit", amount), "debit posting");
    expect(signedAmount(posting).minorUnits).toBe(500n);
  });

  it("is negative for a credit", () => {
    const amount = unwrapOk(Money.ofMinorUnits(500n, "USD"), "5.00 USD");
    const posting = unwrapOk(createPosting("acct-1", "credit", amount), "credit posting");
    expect(signedAmount(posting).minorUnits).toBe(-500n);
  });
});
