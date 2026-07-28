import { describe, expect, it } from "vitest";
import { CURRENCIES, type Currency, minorUnitExponent, parseCurrency } from "./currency";

/**
 * Every code on the known-exponent allowlist declared in `currency.ts` / ADR 0002.
 *
 * Deliberately still written out by hand rather than aliased to `CURRENCIES`.
 * If both sides of these assertions came from the same export, deleting a
 * currency from the implementation would delete it from the test too and
 * everything would still pass. This literal is the independent witness.
 */
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

describe("CURRENCIES", () => {
  it("lists exactly the allowlist, with no extra and none missing", () => {
    // Order-insensitive on purpose: this asserts membership agreement. The
    // ordering contract is asserted separately below.
    expect([...CURRENCIES].sort()).toEqual([...KNOWN_CURRENCIES].sort());
  });

  it("agrees with parseCurrency in both directions", () => {
    // Forward: everything offered is accepted. A picker must never present a
    // code the parser will reject.
    for (const code of CURRENCIES) {
      expect(parseCurrency(code).ok).toBe(true);
    }
    // Backward: everything accepted is offered. A code the parser knows but
    // the list omits is unreachable from any UI built on this list.
    for (const code of KNOWN_CURRENCIES) {
      expect(CURRENCIES).toContain(code);
    }
  });

  it("has a known exponent for every entry", () => {
    for (const code of CURRENCIES) {
      expect([0, 2, 3]).toContain(minorUnitExponent(code));
    }
  });

  it("is grouped by exponent — the order a picker should render", () => {
    expect([...CURRENCIES]).toEqual(["USD", "EUR", "GBP", "UAH", "CHF", "PLN", "JPY", "ISK", "BHD", "KWD"]);
  });

  it("is frozen, so a consumer cannot mutate the shared allowlist", () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true);
    // The array is shared by every consumer in the process; a stray `push`
    // in the console would silently widen what the picker offers.
    expect(() => {
      (CURRENCIES as Currency[]).push("XXX" as Currency);
    }).toThrow();
  });
});
