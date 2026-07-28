import { describe, expect, it } from "vitest";

import { Money } from "@fintech-ledger-sandbox/core";

import { CURRENCIES, minorUnitExponent } from "./currencies";
import { parseBoundedAmount } from "./money";

/**
 * This module is a re-export, so there is no logic of its own to test. What is
 * worth asserting is the *contract the console will build on*: that the list
 * is reachable through this path at all, and that every code it offers can
 * actually complete a round trip through the same parser the write endpoints
 * use. A picker that offers a code `transactions.create` would reject with
 * `422 unsupported_currency` is the failure this guards against.
 */
describe("currencies contract", () => {
  it("exposes the full allowlist through the api package's subpath", () => {
    expect(CURRENCIES.length).toBe(10);
    expect(CURRENCIES).toContain("USD");
    expect(CURRENCIES).toContain("JPY");
    expect(CURRENCIES).toContain("BHD");
  });

  it("every offered currency survives the boundary parser the write endpoints use", () => {
    for (const currency of CURRENCIES) {
      // "1" is well-formed at every exponent — no fraction digits to exceed.
      const parsed = parseBoundedAmount("1", currency);
      expect(parsed.ok).toBe(true);
    }
  });

  it("round-trips a currency's own minimal unit at its declared exponent", () => {
    for (const currency of CURRENCIES) {
      const exponent = minorUnitExponent(currency);
      // One minor unit rendered, then re-parsed, must return one minor unit.
      // For USD that is "0.01"; for JPY "1"; for BHD "0.001".
      const oneMinorUnit = Money.ofMinorUnits(1n, currency);
      expect(oneMinorUnit.ok).toBe(true);
      if (!oneMinorUnit.ok) {
        throw new Error(`expected ${currency} to build`);
      }

      const rendered = oneMinorUnit.value.format();
      const reparsed = parseBoundedAmount(rendered, currency);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) {
        throw new Error(`expected ${rendered} ${currency} to re-parse`);
      }
      expect(reparsed.value.minorUnits).toBe(1n);

      // And the rendered form actually carries the declared number of
      // fraction digits — the property a hardcoded exponent of 2 would break.
      const fractionDigits = rendered.includes(".") ? (rendered.split(".")[1]?.length ?? 0) : 0;
      expect(fractionDigits).toBe(exponent);
    }
  });

  it("rejects a code that is not on the list, rather than defaulting its exponent", () => {
    expect(parseBoundedAmount("1.00", "XXX").ok).toBe(false);
  });
});
