import { Money } from "@fintech-ledger-sandbox/core";
import { describe, expect, it } from "vitest";

import { decimalAmountSchema, MAX_DECIMAL_AMOUNT_LENGTH, toWireMoney, toWireMoneyFromMinorUnits } from "./money";

function money(decimal: string, currency = "USD"): Money {
  const result = Money.parse(decimal, currency);
  if (!result.ok) {
    throw new Error(`fixture amount "${decimal}" is malformed`);
  }
  return result.value;
}

describe("toWireMoney", () => {
  it("encodes the amount as a decimal string, never a number", () => {
    const wire = toWireMoney(money("12.34"));

    expect(wire).toEqual({ amount: "12.34", currency: "USD" });
    expect(typeof wire.amount).toBe("string");
  });

  it("round-trips through Money.parse", () => {
    for (const decimal of ["0.00", "0.01", "12.34", "-5.00", "999999999999.99"]) {
      const wire = toWireMoney(money(decimal));
      const reparsed = Money.parse(wire.amount, wire.currency);

      expect(reparsed.ok).toBe(true);
      if (reparsed.ok) {
        expect(reparsed.value.equals(money(decimal))).toBe(true);
      }
    }
  });

  it("respects each currency's own exponent", () => {
    // JPY is exponent 0 and BHD exponent 3. A wire format that assumed two
    // decimal places would be a silent 100x error on both.
    expect(toWireMoney(money("100", "JPY"))).toEqual({ amount: "100", currency: "JPY" });
    expect(toWireMoney(money("1.234", "BHD"))).toEqual({ amount: "1.234", currency: "BHD" });
  });

  it("survives a value far beyond Number.MAX_SAFE_INTEGER", () => {
    // The whole reason ADR 0002 chose bigint. If this crossed the wire as a
    // JSON number it would lose precision here, at the last hop.
    const huge = Money.ofMinorUnits(9_007_199_254_740_993n, "USD");
    expect(huge.ok).toBe(true);
    if (huge.ok) {
      expect(toWireMoney(huge.value).amount).toBe("90071992547409.93");
    }
  });
});

describe("toWireMoneyFromMinorUnits", () => {
  it("encodes a raw persisted balance", () => {
    expect(toWireMoneyFromMinorUnits(1234n, "USD")).toEqual({ amount: "12.34", currency: "USD" });
  });

  it("encodes a zero balance", () => {
    expect(toWireMoneyFromMinorUnits(0n, "USD")).toEqual({ amount: "0.00", currency: "USD" });
  });

  it("encodes a negative balance, which external accounts legitimately hold", () => {
    expect(toWireMoneyFromMinorUnits(-5000n, "USD")).toEqual({ amount: "-50.00", currency: "USD" });
  });

  it("throws on a corrupt persisted currency rather than guessing a scale", () => {
    // Reaching here means a row was written outside the sanctioned write
    // path. That is an infrastructure bug, not a domain error a caller can
    // act on — and formatting at a guessed exponent would be a silent 100x
    // error, which ADR 0002 exists to prevent.
    expect(() => toWireMoneyFromMinorUnits(100n, "XYZ")).toThrow();
  });
});

describe("decimalAmountSchema", () => {
  it("accepts a normal amount", () => {
    expect(decimalAmountSchema.safeParse("12.34").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(decimalAmountSchema.safeParse("").success).toBe(false);
  });

  it("rejects a string long enough to make BigInt parsing expensive", () => {
    // The Phase 2 deferral this closes: BigInt parsing is superlinear in
    // digit count, so an unbounded numeric string is a cheap CPU sink. The
    // cap must reject it before Money.parse ever sees it.
    const huge = "9".repeat(1_000_000);
    expect(decimalAmountSchema.safeParse(huge).success).toBe(false);
  });

  it("accepts a value exactly at the cap and rejects one character more", () => {
    expect(decimalAmountSchema.safeParse("9".repeat(MAX_DECIMAL_AMOUNT_LENGTH)).success).toBe(true);
    expect(decimalAmountSchema.safeParse("9".repeat(MAX_DECIMAL_AMOUNT_LENGTH + 1)).success).toBe(false);
  });
});
