import { describe, expect, it } from "vitest";
import type { Result } from "../result";
import { Money } from "./money";

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

describe("Money.ofMinorUnits — never accepts a number for an amount", () => {
  it("accepts a genuine bigint", () => {
    const money = unwrapOk(Money.ofMinorUnits(1050n, "USD"), "genuine bigint");
    expect(money.minorUnits).toBe(1050n);
    expect(money.currency).toBe("USD");
  });

  it("rejects an integral number cast through an untyped boundary", () => {
    const error = unwrapErr(
      Money.ofMinorUnits(1050 as unknown as bigint, "USD"),
      "integral number",
    );
    expect(error).toEqual({ kind: "InvalidAmount", reason: "not-a-bigint", input: "1050" });
  });

  it("rejects NaN cast through an untyped boundary", () => {
    const error = unwrapErr(Money.ofMinorUnits(Number.NaN as unknown as bigint, "USD"), "NaN");
    expect(error).toEqual({ kind: "InvalidAmount", reason: "not-a-bigint", input: "NaN" });
  });

  it("rejects a float cast through an untyped boundary", () => {
    const error = unwrapErr(Money.ofMinorUnits(10.5 as unknown as bigint, "USD"), "float");
    expect(error).toEqual({ kind: "InvalidAmount", reason: "not-a-bigint", input: "10.5" });
  });
});

describe("Money — an unsupported currency is always rejected, never defaulted to exponent 2", () => {
  it("ofMinorUnits rejects an unknown currency code", () => {
    const error = unwrapErr(Money.ofMinorUnits(100n, "XXX"), "ofMinorUnits unknown currency");
    expect(error).toEqual({ kind: "UnsupportedCurrency", code: "XXX" });
  });

  it("parse rejects an unknown currency code", () => {
    const error = unwrapErr(Money.parse("10.00", "XXX"), "parse unknown currency");
    expect(error).toEqual({ kind: "UnsupportedCurrency", code: "XXX" });
  });
});

describe("Money.parse / Money.format round-trip by value", () => {
  it("round-trips exponent-2 USD", () => {
    const parsed = unwrapOk(Money.parse("12.50", "USD"), "parse 12.50 USD");
    const reparsed = unwrapOk(Money.parse(parsed.format(), "USD"), "reparse formatted USD");
    expect(reparsed.minorUnits).toBe(parsed.minorUnits);
    expect(reparsed.currency).toBe(parsed.currency);
  });

  it("round-trips exponent-0 JPY", () => {
    const parsed = unwrapOk(Money.parse("1200", "JPY"), "parse 1200 JPY");
    const reparsed = unwrapOk(Money.parse(parsed.format(), "JPY"), "reparse formatted JPY");
    expect(reparsed.minorUnits).toBe(parsed.minorUnits);
    expect(reparsed.currency).toBe(parsed.currency);
  });

  it("round-trips exponent-3 BHD", () => {
    const parsed = unwrapOk(Money.parse("12.345", "BHD"), "parse 12.345 BHD");
    const reparsed = unwrapOk(Money.parse(parsed.format(), "BHD"), "reparse formatted BHD");
    expect(reparsed.minorUnits).toBe(parsed.minorUnits);
    expect(reparsed.currency).toBe(parsed.currency);
  });

  it("formats a short decimal padded to the currency's exponent rather than echoing the input string", () => {
    const parsed = unwrapOk(Money.parse("1.5", "USD"), "parse 1.5 USD");
    expect(parsed.format()).toBe("1.50");
  });
});

describe("Money.parse — negative decimal strings", () => {
  it("round-trips a negative exponent-2 USD amount", () => {
    const parsed = unwrapOk(Money.parse("-12.34", "USD"), "parse -12.34 USD");
    expect(parsed.minorUnits).toBe(-1234n);
    expect(parsed.format()).toBe("-12.34");

    const reparsed = unwrapOk(Money.parse(parsed.format(), "USD"), "reparse formatted -12.34 USD");
    expect(reparsed.minorUnits).toBe(parsed.minorUnits);
    expect(reparsed.currency).toBe(parsed.currency);
  });

  it("round-trips a negative exponent-0 JPY amount", () => {
    const parsed = unwrapOk(Money.parse("-5", "JPY"), "parse -5 JPY");
    expect(parsed.minorUnits).toBe(-5n);
    expect(parsed.format()).toBe("-5");

    const reparsed = unwrapOk(Money.parse(parsed.format(), "JPY"), "reparse formatted -5 JPY");
    expect(reparsed.minorUnits).toBe(parsed.minorUnits);
    expect(reparsed.currency).toBe(parsed.currency);
  });

  it("round-trips a negative exponent-3 BHD amount", () => {
    const parsed = unwrapOk(Money.parse("-0.005", "BHD"), "parse -0.005 BHD");
    expect(parsed.minorUnits).toBe(-5n);
    expect(parsed.format()).toBe("-0.005");

    const reparsed = unwrapOk(Money.parse(parsed.format(), "BHD"), "reparse formatted -0.005 BHD");
    expect(reparsed.minorUnits).toBe(parsed.minorUnits);
    expect(reparsed.currency).toBe(parsed.currency);
  });

  it("parses a negative zero-integer-part amount to exactly '-0.05', not '-.05' or '0.-05'", () => {
    const parsed = unwrapOk(Money.parse("-0.05", "USD"), "parse -0.05 USD");
    expect(parsed.minorUnits).toBe(-5n);
    expect(parsed.format()).toBe("-0.05");
  });

  it("parses '-0' and '-0.00' to zero, not a distinct negative-zero value", () => {
    const wholeNegativeZero = unwrapOk(Money.parse("-0", "USD"), "parse -0 USD");
    expect(wholeNegativeZero.minorUnits).toBe(0n);
    expect(wholeNegativeZero.isZero()).toBe(true);

    const fractionalNegativeZero = unwrapOk(Money.parse("-0.00", "USD"), "parse -0.00 USD");
    expect(fractionalNegativeZero.minorUnits).toBe(0n);
    expect(fractionalNegativeZero.isZero()).toBe(true);
  });

  it("a negative parsed amount reports isNegative() true and isPositive() false", () => {
    const parsed = unwrapOk(Money.parse("-12.34", "USD"), "parse -12.34 USD for sign checks");
    expect(parsed.isNegative()).toBe(true);
    expect(parsed.isPositive()).toBe(false);
  });
});

describe("Money.parse rejects malformed decimal strings", () => {
  const malformedInputs = ["", "abc", "NaN", "Infinity", "1e5", ".5", "1.", "-", "--5"];

  for (const input of malformedInputs) {
    it(`rejects ${JSON.stringify(input)} with malformed-decimal`, () => {
      const error = unwrapErr(Money.parse(input, "USD"), `parse ${JSON.stringify(input)}`);
      expect(error).toEqual({ kind: "InvalidAmount", reason: "malformed-decimal", input });
    });
  }
});

describe("Money.parse rejects excess precision instead of rounding", () => {
  it("rejects one fraction digit for JPY, whose exponent is 0", () => {
    const error = unwrapErr(Money.parse("1.5", "JPY"), "1.5 JPY");
    expect(error).toEqual({ kind: "InvalidAmount", reason: "excess-precision", input: "1.5" });
  });

  it("accepts the same fraction digit for USD, whose exponent is 2", () => {
    const result = Money.parse("1.5", "USD");
    expect(result.ok).toBe(true);
  });

  it("rejects a fourth fraction digit for USD, whose exponent is only 2", () => {
    const error = unwrapErr(Money.parse("0.0001", "USD"), "0.0001 USD");
    expect(error).toEqual({ kind: "InvalidAmount", reason: "excess-precision", input: "0.0001" });
  });
});

describe("Money formatting of negative and sub-unit amounts", () => {
  it("formats a negative USD amount with the sign before the integer part", () => {
    const money = unwrapOk(Money.ofMinorUnits(-5n, "USD"), "-5 minor units USD");
    expect(money.format()).toBe("-0.05");
  });

  it("formats a sub-unit exponent-3 BHD amount", () => {
    const money = unwrapOk(Money.ofMinorUnits(5n, "BHD"), "5 minor units BHD");
    expect(money.format()).toBe("0.005");
  });
});

describe("Money.add / subtract / compare across mismatched currencies", () => {
  it("add rejects mismatched currencies without leaking a numeric result", () => {
    const usd = unwrapOk(Money.ofMinorUnits(100n, "USD"), "100 USD");
    const eur = unwrapOk(Money.ofMinorUnits(100n, "EUR"), "100 EUR");
    const result = usd.add(eur);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a CurrencyMismatch");
    }
    expect(result.error).toEqual({ kind: "CurrencyMismatch", expected: "USD", actual: "EUR" });
    expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
  });

  it("subtract rejects mismatched currencies without leaking a numeric result", () => {
    const usd = unwrapOk(Money.ofMinorUnits(100n, "USD"), "100 USD");
    const jpy = unwrapOk(Money.ofMinorUnits(100n, "JPY"), "100 JPY");
    const result = usd.subtract(jpy);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a CurrencyMismatch");
    }
    expect(result.error).toEqual({ kind: "CurrencyMismatch", expected: "USD", actual: "JPY" });
    expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
  });

  it("compare rejects mismatched currencies without leaking a numeric result", () => {
    const usd = unwrapOk(Money.ofMinorUnits(100n, "USD"), "100 USD");
    const bhd = unwrapOk(Money.ofMinorUnits(100n, "BHD"), "100 BHD");
    const result = usd.compare(bhd);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a CurrencyMismatch");
    }
    expect(result.error).toEqual({ kind: "CurrencyMismatch", expected: "USD", actual: "BHD" });
    expect(Object.keys(result).sort()).toEqual(["error", "ok"]);
  });

  it("compare orders same-currency amounts by minor units", () => {
    const five = unwrapOk(Money.ofMinorUnits(500n, "USD"), "5.00 USD");
    const three = unwrapOk(Money.ofMinorUnits(300n, "USD"), "3.00 USD");
    expect(unwrapOk(five.compare(three), "5 vs 3")).toBe(1);
    expect(unwrapOk(three.compare(five), "3 vs 5")).toBe(-1);
    expect(unwrapOk(three.compare(three), "3 vs 3")).toBe(0);
  });
});

describe("Money arithmetic exactness beyond IEEE-754 doubles", () => {
  it("sums 0.10 USD + 0.20 USD to exactly 30 minor units, not a floating-point artifact", () => {
    const a = unwrapOk(Money.parse("0.10", "USD"), "0.10 USD");
    const b = unwrapOk(Money.parse("0.20", "USD"), "0.20 USD");
    const sum = unwrapOk(a.add(b), "0.10 + 0.20");
    expect(sum.minorUnits).toBe(30n);
    expect(sum.format()).toBe("0.30");
  });

  it("preserves a minor-units value beyond Number.MAX_SAFE_INTEGER exactly, proving bigint is real", () => {
    const beyondSafeInteger = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    expect(beyondSafeInteger > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);

    const money = unwrapOk(Money.ofMinorUnits(beyondSafeInteger, "USD"), "beyond MAX_SAFE_INTEGER");
    expect(typeof money.minorUnits).toBe("bigint");

    const doubled = unwrapOk(money.add(money), "double beyond-safe-integer amount");
    expect(doubled.minorUnits).toBe(beyondSafeInteger * 2n);
  });
});

describe("Money value helpers", () => {
  it("negate flips the sign and keeps the currency", () => {
    const money = unwrapOk(Money.parse("5.00", "USD"), "5.00 USD");
    const negated = money.negate();
    expect(negated.minorUnits).toBe(-500n);
    expect(negated.currency).toBe("USD");
  });

  it("isZero/isPositive/isNegative classify the sign", () => {
    const zero = unwrapOk(Money.ofMinorUnits(0n, "USD"), "0 USD");
    const positive = unwrapOk(Money.ofMinorUnits(1n, "USD"), "1 USD");
    const negative = unwrapOk(Money.ofMinorUnits(-1n, "USD"), "-1 USD");

    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);

    expect(positive.isPositive()).toBe(true);
    expect(positive.isZero()).toBe(false);

    expect(negative.isNegative()).toBe(true);
    expect(negative.isZero()).toBe(false);
  });

  it("equals compares currency and minor units, never throws on a mismatch", () => {
    const a = unwrapOk(Money.ofMinorUnits(100n, "USD"), "100 USD (a)");
    const b = unwrapOk(Money.ofMinorUnits(100n, "USD"), "100 USD (b)");
    const differentAmount = unwrapOk(Money.ofMinorUnits(200n, "USD"), "200 USD");
    const differentCurrency = unwrapOk(Money.ofMinorUnits(100n, "EUR"), "100 EUR");

    expect(a.equals(b)).toBe(true);
    expect(a.equals(differentAmount)).toBe(false);
    expect(a.equals(differentCurrency)).toBe(false);
  });
});
