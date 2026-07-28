import { describe, expect, it } from "vitest";

import { formatTransactionTotal, transactionTotalMinorUnits, type WirePosting } from "./total";

function debit(amount: string, currency = "USD"): WirePosting {
  return { direction: "debit", amount: { amount, currency } };
}

function credit(amount: string, currency = "USD"): WirePosting {
  return { direction: "credit", amount: { amount, currency } };
}

describe("transactionTotalMinorUnits", () => {
  it("returns the moved amount for an ordinary two-leg transfer", () => {
    expect(transactionTotalMinorUnits([debit("12.34"), credit("12.34")])).toBe(1234n);
  });

  it("sums every debit leg of a split, rather than reporting only the first", () => {
    // The case a scalar `amount` field on the wire could not have represented.
    expect(transactionTotalMinorUnits([debit("5.00"), debit("5.00"), credit("10.00")])).toBe(1000n);
  });

  it("counts debits only, so a balanced transaction is not double-counted", () => {
    expect(transactionTotalMinorUnits([debit("10.00"), credit("10.00")])).toBe(1000n);
  });

  it("survives amounts no float could hold", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. ADR 0002 exists for this.
    expect(transactionTotalMinorUnits([debit("0.10"), debit("0.20"), credit("0.30")])).toBe(30n);
  });

  it("handles a zero-exponent currency without inventing decimal places", () => {
    expect(transactionTotalMinorUnits([debit("500", "JPY"), credit("500", "JPY")])).toBe(500n);
  });

  it("returns null rather than a partial sum when a leg will not parse", () => {
    // A number that silently drops an unreadable leg would understate what
    // moved while looking authoritative.
    expect(transactionTotalMinorUnits([debit("not-a-number"), credit("1.00")])).toBeNull();
  });

  it("returns null when debit legs disagree on currency", () => {
    expect(transactionTotalMinorUnits([debit("1.00", "USD"), debit("1.00", "EUR")])).toBeNull();
  });

  it("returns null for an unknown currency rather than guessing a scale", () => {
    expect(transactionTotalMinorUnits([debit("1.00", "XXX")])).toBeNull();
  });

  it("returns null when there are no debits at all", () => {
    expect(transactionTotalMinorUnits([])).toBeNull();
    expect(transactionTotalMinorUnits([credit("1.00")])).toBeNull();
  });
});

describe("formatTransactionTotal", () => {
  it("renders at the currency's own scale with the code", () => {
    expect(formatTransactionTotal([debit("12.34"), credit("12.34")])).toBe("12.34 USD");
  });

  it("renders a zero-exponent currency with no decimal point", () => {
    expect(formatTransactionTotal([debit("500", "JPY"), credit("500", "JPY")])).toBe("500 JPY");
  });

  it("returns null when the total is unknowable, so the caller can say so", () => {
    // Distinct from "0.00", which would claim nothing moved.
    expect(formatTransactionTotal([debit("bad"), credit("1.00")])).toBeNull();
  });
});
