import { describe, expect, it } from "vitest";

import { checkConversion, convert, MAX_RATE_SCALE, Rate } from "./exchange";
import { Money } from "./money";

function money(decimal: string, currency: string): Money {
  const parsed = Money.parse(decimal, currency);
  if (!parsed.ok) {
    throw new Error(`fixture amount ${decimal} ${currency} did not parse`);
  }
  return parsed.value;
}

function rate(text: string): Rate {
  const parsed = Rate.parse(text);
  if (!parsed.ok) {
    throw new Error(`fixture rate ${text} did not parse: ${parsed.error.reason}`);
  }
  return parsed.value;
}

describe("Rate.parse", () => {
  it("holds a rate exactly as numerator and scale", () => {
    const parsed = rate("0.9235");

    expect(parsed.numerator).toBe(9235n);
    expect(parsed.scale).toBe(4);
    // The caller's own text survives, so what gets stored and shown is what was
    // agreed — not a re-rendering that might normalise "0.9200" to "0.92".
    expect(parsed.text).toBe("0.9235");
  });

  it("accepts a whole-number rate", () => {
    expect(rate("120").numerator).toBe(120n);
    expect(rate("120").scale).toBe(0);
  });

  it("rejects zero and negatives, which have no meaning as a rate", () => {
    // Zero would convert every amount to nothing; a negative would produce a
    // negative target amount that `createPosting` then rejects far from the
    // actual mistake.
    expect(Rate.parse("0")).toMatchObject({ ok: false, error: { reason: "not-positive" } });
    expect(Rate.parse("0.000")).toMatchObject({ ok: false, error: { reason: "not-positive" } });
    expect(Rate.parse("-0.92")).toMatchObject({
      ok: false,
      error: { reason: "malformed-decimal" },
    });
  });

  it("rejects excess precision rather than truncating it", () => {
    const tooPrecise = `0.${"1".repeat(MAX_RATE_SCALE + 1)}`;
    expect(Rate.parse(tooPrecise)).toMatchObject({
      ok: false,
      error: { reason: "excess-precision" },
    });
  });

  it("bounds the input before it reaches BigInt", () => {
    // `BigInt` parsing is superlinear in digit count, so an unbounded string is
    // a cheap CPU sink. Length is checked before the digits are parsed.
    expect(Rate.parse("9".repeat(64))).toMatchObject({ ok: false, error: { reason: "too-long" } });
  });

  it("rejects the shapes a regex-free parser would let through", () => {
    for (const bad of ["", "  ", "abc", "1e5", "Infinity", "NaN", "1.2.3", ".5", "1.", "+1.0"]) {
      expect(Rate.parse(bad).ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(rate("  0.92  ").numerator).toBe(92n);
  });
});

describe("convert", () => {
  it("converts exactly when the product lands on a minor unit", () => {
    expect(convert(money("100.00", "USD"), rate("0.92"), "EUR")).toMatchObject({
      ok: true,
      value: { minorUnits: 9200n, currency: "EUR" },
    });
  });

  it("rounds half-up once, at the target scale", () => {
    // 33.33 x 0.92 = 30.6636 EUR. Two decimals available, so 30.66.
    expect(convert(money("33.33", "USD"), rate("0.92"), "EUR")).toMatchObject({
      ok: true,
      value: { minorUnits: 3066n },
    });
    // 0.005 -> 0.01, not 0.00: half rounds away from zero.
    expect(convert(money("0.10", "USD"), rate("0.05"), "EUR")).toMatchObject({
      ok: true,
      value: { minorUnits: 1n },
    });
  });

  it("crosses currency scales without rounding twice", () => {
    // USD (exponent 2) -> JPY (exponent 0). 10.00 USD at 150 is 1500 JPY.
    expect(convert(money("10.00", "USD"), rate("150"), "JPY")).toMatchObject({
      ok: true,
      value: { minorUnits: 1500n, currency: "JPY" },
    });
    // JPY (0) -> BHD (3) shifts by a thousand. 1000 JPY at 0.0025 is 2.500 BHD.
    expect(convert(money("1000", "JPY"), rate("0.0025"), "BHD")).toMatchObject({
      ok: true,
      value: { minorUnits: 2500n, currency: "BHD" },
    });
    // The scale shift folded into the same fraction: 1 JPY at 0.0025 is
    // 0.0025 BHD, which is 0.003 at BHD's three places after one half-up.
    // Rounding the scale shift separately would give 0.002 or 0.000.
    expect(convert(money("1", "JPY"), rate("0.0025"), "BHD")).toMatchObject({
      ok: true,
      value: { minorUnits: 3n },
    });
  });

  it("keeps a rate of 1 an identity, across equal scales", () => {
    expect(convert(money("12.34", "USD"), rate("1"), "EUR")).toMatchObject({
      ok: true,
      value: { minorUnits: 1234n },
    });
  });

  it("stays exact on amounts far past float precision", () => {
    // The reason none of this is a `number`. 9_007_199_254_740_993 is the first
    // integer a double cannot represent; a float-based conversion loses it.
    const large = Money.ofMinorUnits(9_007_199_254_740_993n, "USD");
    expect(large.ok).toBe(true);
    if (!large.ok) {
      return;
    }
    expect(convert(large.value, rate("1"), "EUR")).toMatchObject({
      ok: true,
      value: { minorUnits: 9_007_199_254_740_993n },
    });
  });

  it("rejects an unknown target currency rather than guessing a scale", () => {
    expect(convert(money("10.00", "USD"), rate("0.92"), "XXX" as never)).toMatchObject({
      ok: false,
    });
  });

  it("converts zero to zero", () => {
    expect(convert(money("0.00", "USD"), rate("0.92"), "EUR")).toMatchObject({
      ok: true,
      value: { minorUnits: 0n },
    });
  });
});

describe("checkConversion", () => {
  it("accepts the correctly converted amount", () => {
    expect(
      checkConversion(money("100.00", "USD"), rate("0.92"), money("92.00", "EUR")),
    ).toMatchObject({ ok: true, value: { minorUnits: 9200n } });
  });

  it("reports what the amount should have been, not merely that it was wrong", () => {
    // The whole reason this returns the expected `Money`: on a screen where
    // someone typed the rate, "expected 92.00" is actionable and "invalid
    // conversion" is not.
    const result = checkConversion(money("100.00", "USD"), rate("0.92"), money("91.00", "EUR"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({
      kind: "ConversionMismatch",
      expected: { minorUnits: 9200n, currency: "EUR" },
      stated: { minorUnits: 9100n, currency: "EUR" },
    });
  });

  it("rejects an amount that is off by a single minor unit", () => {
    // The tolerance is zero. A conversion either is the canonical rounding of
    // the stated rate or it is not, and "close enough" on a ledger is how a
    // cent per transaction goes missing.
    expect(checkConversion(money("33.33", "USD"), rate("0.92"), money("30.67", "EUR")).ok).toBe(
      false,
    );
    expect(checkConversion(money("33.33", "USD"), rate("0.92"), money("30.66", "EUR")).ok).toBe(
      true,
    );
  });
});
