import { CURRENCIES, minorUnitExponent } from "@fintech-ledger-sandbox/api/contracts/currencies";
import { MAX_DECIMAL_AMOUNT_LENGTH, MAX_MINOR_UNITS } from "@fintech-ledger-sandbox/api/contracts/money";
import { describe, expect, it } from "vitest";

import { asCurrency, formatAmountWithCurrency, formatMinorUnits, parseAmount } from "./amount";

describe("asCurrency", () => {
  it("accepts every code on the allowlist", () => {
    for (const code of CURRENCIES) {
      expect(asCurrency(code)).toBe(code);
    }
  });

  it("rejects an unknown code rather than passing it through", () => {
    expect(asCurrency("XXX")).toBeNull();
    expect(asCurrency("")).toBeNull();
    expect(asCurrency("usd")).toBeNull();
  });
});

describe("parseAmount — the exponent is per-currency and never guessed", () => {
  // The core of ADR 0002. A hardcoded exponent of 2 passes every USD case in
  // this file and silently misplaces the decimal point on the other four.
  it("parses one whole unit correctly at each of the three real-world scales", () => {
    expect(parseAmount("1", "JPY")).toEqual({ ok: true, minorUnits: 1n });
    expect(parseAmount("1", "USD")).toEqual({ ok: true, minorUnits: 100n });
    expect(parseAmount("1", "BHD")).toEqual({ ok: true, minorUnits: 1000n });
  });

  it("rejects JPY '12.50' — exponent 0 admits no fraction digits at all", () => {
    expect(parseAmount("12.50", "JPY")).toEqual({ ok: false, problem: "excess_precision" });
  });

  it("reads JPY '1250' as 1250 minor units, not 125000", () => {
    expect(parseAmount("1250", "JPY")).toEqual({ ok: true, minorUnits: 1250n });
  });

  it("reads BHD '1.250' as 1250 minor units at exponent 3", () => {
    expect(parseAmount("1.250", "BHD")).toEqual({ ok: true, minorUnits: 1250n });
  });

  it("rejects USD '12.505' as excess precision rather than rounding it", () => {
    // Explicitly NOT 1250n or 1251n. Rounding here would be the console
    // deciding where someone's half-cent went.
    expect(parseAmount("12.505", "USD")).toEqual({ ok: false, problem: "excess_precision" });
  });

  it("accepts an amount with exactly the currency's number of fraction digits", () => {
    for (const currency of CURRENCIES) {
      const exponent = minorUnitExponent(currency);
      const decimal = exponent === 0 ? "7" : `7.${"0".repeat(exponent)}`;
      const parsed = parseAmount(decimal, currency);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(`expected ${decimal} ${currency} to parse`);
      }
      expect(parsed.minorUnits).toBe(BigInt(7) * BigInt(10) ** BigInt(exponent));
    }
  });

  it("rejects one more fraction digit than the currency permits, for every currency", () => {
    for (const currency of CURRENCIES) {
      const exponent = minorUnitExponent(currency);
      const decimal = `7.${"0".repeat(exponent + 1)}`;
      expect(parseAmount(decimal, currency)).toEqual({ ok: false, problem: "excess_precision" });
    }
  });
});

describe("parseAmount — malformed input", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["NaN", "malformed"],
    ["Infinity", "malformed"],
    ["1e5", "malformed"],
    [".5", "malformed"],
    ["5.", "malformed"],
    ["1,000", "malformed"],
    ["$5", "malformed"],
    ["--5", "malformed"],
    ["5 5", "malformed"],
  ])("rejects %j as %s", (input, problem) => {
    expect(parseAmount(input, "USD")).toEqual({ ok: false, problem });
  });

  it("rejects an unknown currency before attempting to scale anything", () => {
    expect(parseAmount("10.00", "XXX")).toEqual({ ok: false, problem: "unsupported_currency" });
  });

  it("trims surrounding whitespace rather than rejecting a pasted value", () => {
    expect(parseAmount("  12.50  ", "USD")).toEqual({ ok: true, minorUnits: 1250n });
  });
});

describe("parseAmount — bounds", () => {
  it("rejects a string longer than the server's length cap before it reaches BigInt", () => {
    const tooLong = "1".repeat(MAX_DECIMAL_AMOUNT_LENGTH + 1);
    expect(parseAmount(tooLong, "USD")).toEqual({ ok: false, problem: "too_long" });
  });

  it("accepts the largest storable value and rejects one minor unit more", () => {
    // MAX_MINOR_UNITS is int8's ceiling; one above it is a value Postgres
    // would refuse with a raw 22003, surfacing as an unaudited 500.
    const maxAsDecimal = formatMinorUnits(MAX_MINOR_UNITS, "USD");
    expect(parseAmount(maxAsDecimal, "USD")).toEqual({ ok: true, minorUnits: MAX_MINOR_UNITS });

    const overflowing = formatMinorUnits(MAX_MINOR_UNITS + 1n, "USD");
    expect(parseAmount(overflowing, "USD")).toEqual({ ok: false, problem: "out_of_range" });
  });

  it("distinguishes out-of-range from malformed, which the server collapses together", () => {
    const overflowing = formatMinorUnits(MAX_MINOR_UNITS + 1n, "USD");
    const ranged = parseAmount(overflowing, "USD");
    const malformed = parseAmount("NaN", "USD");
    expect(ranged.ok).toBe(false);
    expect(malformed.ok).toBe(false);
    // Both are `422 invalid_amount` on the wire; they are different problems
    // to the person typing, so the console recovers the distinction.
    expect(ranged).not.toEqual(malformed);
  });

  it("accepts zero and rejects nothing about a negative — sign is the caller's rule, not the parser's", () => {
    expect(parseAmount("0", "USD")).toEqual({ ok: true, minorUnits: 0n });
    expect(parseAmount("-1.00", "USD")).toEqual({ ok: true, minorUnits: -100n });
  });
});

describe("formatMinorUnits", () => {
  it("renders zero at each currency's own scale", () => {
    expect(formatMinorUnits(0n, "USD")).toBe("0.00");
    expect(formatMinorUnits(0n, "JPY")).toBe("0");
    expect(formatMinorUnits(0n, "BHD")).toBe("0.000");
  });

  it("pads a sub-unit amount rather than dropping the leading zero", () => {
    expect(formatMinorUnits(5n, "USD")).toBe("0.05");
    expect(formatMinorUnits(5n, "BHD")).toBe("0.005");
  });

  it("keeps the sign on a negative balance, which external accounts legitimately hold", () => {
    expect(formatMinorUnits(-5n, "USD")).toBe("-0.05");
    expect(formatMinorUnits(-500000n, "USD")).toBe("-5000.00");
    expect(formatMinorUnits(-1n, "JPY")).toBe("-1");
  });

  it("round-trips through parseAmount for every currency", () => {
    for (const currency of CURRENCIES) {
      for (const minorUnits of [0n, 1n, -1n, 999n, -999n, 123456789n]) {
        const rendered = formatMinorUnits(minorUnits, currency);
        const reparsed = parseAmount(rendered, currency);
        expect(reparsed.ok).toBe(true);
        if (!reparsed.ok) {
          throw new Error(`expected ${rendered} ${currency} to re-parse`);
        }
        expect(reparsed.minorUnits).toBe(minorUnits);
      }
    }
  });

  it("refuses to guess a scale for an unknown currency", () => {
    // Obviously-unformatted beats plausibly-wrong: "1250 XXX" cannot be
    // mistaken for a formatted amount, whereas "12.50 XXX" could.
    expect(formatMinorUnits(1250n, "XXX")).toBe("1250 XXX");
  });

  it("appends the code in the display form", () => {
    expect(formatAmountWithCurrency(1250n, "USD")).toBe("12.50 USD");
    expect(formatAmountWithCurrency(1250n, "JPY")).toBe("1250 JPY");
  });

  it("does not double the code for an unknown currency", () => {
    // `formatMinorUnits` already appends the code when it has no scale to
    // render, so appending unconditionally produced "1250 XXX XXX".
    expect(formatAmountWithCurrency(1250n, "XXX")).toBe("1250 XXX");
  });
});
