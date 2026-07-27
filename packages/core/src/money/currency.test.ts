import { describe, expect, it } from "vitest";
import { minorUnitExponent, parseCurrency } from "./currency";

/** Every code on the known-exponent allowlist declared in `currency.ts` / ADR 0002. */
const KNOWN_CURRENCIES = ["USD", "EUR", "GBP", "UAH", "CHF", "PLN", "JPY", "ISK", "BHD", "KWD"] as const;

describe("parseCurrency", () => {
  it("accepts every currency on the known-exponent allowlist", () => {
    for (const code of KNOWN_CURRENCIES) {
      const result = parseCurrency(code);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`expected ${code} to be a known currency`);
      }
      expect(result.value).toBe(code);
    }
  });

  it("rejects an unrecognized code with a typed UnsupportedCurrency, never a default exponent", () => {
    const result = parseCurrency("XXX");
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected XXX to be rejected");
    }
    expect(result.error).toEqual({ kind: "UnsupportedCurrency", code: "XXX" });
  });

  it("rejects the empty string", () => {
    const result = parseCurrency("");
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the empty string to be rejected");
    }
    expect(result.error).toEqual({ kind: "UnsupportedCurrency", code: "" });
  });

  it("is case-sensitive — a lowercase variant of a known code is not accepted", () => {
    const result = parseCurrency("usd");
    expect(result.ok).toBe(false);
  });

  it("never treats an inherited Object.prototype member as a known currency", () => {
    // `Object.hasOwn` is what makes this safe; `"toString" in {}` would be true.
    const result = parseCurrency("toString");
    expect(result.ok).toBe(false);
  });
});

describe("minorUnitExponent", () => {
  it("reports the known ISO-4217 minor-unit exponent for each real-world exponent scale", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("BHD")).toBe(3);
  });
});
