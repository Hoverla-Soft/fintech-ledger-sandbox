import type { InvalidAmount, InvalidRate, UnsupportedCurrency } from "../errors";
import { err, ok, type Result } from "../result";
import { type Currency, minorUnitExponent } from "./currency";
import { Money } from "./money";

/**
 * Exchange-rate arithmetic, in exact integers.
 *
 * ## Why a rate is not a `number`
 *
 * `0.1 + 0.2 !== 0.3` is why `Money` is `bigint` minor units (ADR 0002), and a
 * rate multiplied into an amount is the same hazard with a longer lever: a rate
 * held as a float turns a conversion into an approximation whose error scales
 * with the amount. A rate here is a decimal string parsed into an integer
 * numerator plus a scale, and every conversion is integer multiply-and-divide.
 * No `number` touches the value path.
 *
 * ## Who owns the rounding
 *
 * A conversion almost never lands exactly on a minor unit — 33.33 USD at 0.92
 * is 30.6636 EUR, and EUR has two decimal places. Something has to decide where
 * the remaining fraction goes, and this module's position is that **the caller
 * declares the result and the server verifies it**: `convert` computes the one
 * canonical answer (half-up at the target currency's scale) and
 * `checkConversion` reports whether the caller's stated amount is that answer.
 *
 * That split matters. It keeps the ledger from silently reinterpreting a number
 * someone typed — the ADR 0002 rule — while still refusing a target amount that
 * cannot be derived from the stated rate, which is what makes the recorded rate
 * meaningful rather than decorative.
 */

/**
 * Most fraction digits a rate may carry.
 *
 * Ten is well past any published FX rate (major pairs quote to 4–5 decimal
 * places) and keeps the intermediate `BigInt` small. The cap exists for the same
 * reason `MAX_DECIMAL_AMOUNT_LENGTH` does: `BigInt` parsing is superlinear in
 * digit count, so an unbounded fraction is a cheap way to burn CPU.
 */
export const MAX_RATE_SCALE = 10;

/** Bounds the whole string before it reaches `BigInt`, for the same reason. */
export const MAX_RATE_LENGTH = 32;

const RATE_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * A positive exchange rate, held exactly as `numerator / 10^scale`.
 *
 * Deliberately not a `Money` — a rate is dimensionless and has no currency, and
 * modelling it as money invites adding it to an amount.
 */
export class Rate {
  readonly numerator: bigint;
  readonly scale: number;
  /** The rate as the caller wrote it, preserved for storage and display. */
  readonly text: string;

  private constructor(numerator: bigint, scale: number, text: string) {
    this.numerator = numerator;
    this.scale = scale;
    this.text = text;
    Object.freeze(this);
  }

  /**
   * Parses a decimal rate string.
   *
   * Rejects a negative sign outright rather than parsing it: a negative rate has
   * no meaning, and accepting one would let a conversion produce a negative
   * target amount, which `createPosting` would then reject far from the actual
   * mistake. Zero is rejected for the same reason — it would convert every
   * amount to nothing.
   */
  static parse(text: string): Result<Rate, InvalidRate> {
    const trimmed = text.trim();

    if (trimmed.length === 0) {
      return err({ kind: "InvalidRate", reason: "malformed-decimal", input: text });
    }
    if (trimmed.length > MAX_RATE_LENGTH) {
      return err({ kind: "InvalidRate", reason: "too-long", input: text });
    }

    const match = RATE_PATTERN.exec(trimmed);
    if (match === null) {
      return err({ kind: "InvalidRate", reason: "malformed-decimal", input: text });
    }

    const [, integerDigits = "", fractionDigits = ""] = match;
    if (fractionDigits.length > MAX_RATE_SCALE) {
      return err({ kind: "InvalidRate", reason: "excess-precision", input: text });
    }

    const numerator = BigInt(`${integerDigits}${fractionDigits}`);
    if (numerator === 0n) {
      return err({ kind: "InvalidRate", reason: "not-positive", input: text });
    }

    return ok(new Rate(numerator, fractionDigits.length, trimmed));
  }
}

/**
 * Divides two positive integers, rounding half away from zero.
 *
 * Half-up rather than banker's rounding because it is the rule a person checking
 * the arithmetic by hand will apply, and this result has to be reproducible by
 * whoever declared the target amount. Both arguments are positive by
 * construction here — amounts on a posting are strictly positive and a `Rate`
 * cannot be zero or negative — so there is no sign case to get wrong.
 */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function tenToThe(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * The canonical converted amount: `amount × rate`, expressed in `target`'s minor
 * units, rounded half-up exactly once.
 *
 * The whole computation is one integer multiply and one integer divide, so there
 * is no accumulated error and no intermediate rounding. Scale differences between
 * the two currencies are folded into the same fraction rather than applied as a
 * separate step — converting 100 JPY (exponent 0) to BHD (exponent 3) has to
 * shift by a thousand, and doing that as its own rounding pass would round twice.
 */
export function convert(
  amount: Money,
  rate: Rate,
  target: Currency,
): Result<Money, UnsupportedCurrency | InvalidAmount> {
  const sourceExponent = minorUnitExponent(amount.currency);
  const targetExponent = minorUnitExponent(target);
  const exponentShift = targetExponent - sourceExponent;

  const numerator =
    amount.minorUnits * rate.numerator * (exponentShift > 0 ? tenToThe(exponentShift) : 1n);
  const denominator = tenToThe(rate.scale) * (exponentShift < 0 ? tenToThe(-exponentShift) : 1n);

  return Money.ofMinorUnits(divideRoundHalfUp(numerator, denominator), target);
}

/** Why a stated target amount was not accepted for a conversion. */
export interface ConversionMismatch {
  readonly kind: "ConversionMismatch";
  /** What `amount × rate` actually comes to at the target currency's scale. */
  readonly expected: Money;
  /** What the caller said it comes to. */
  readonly stated: Money;
}

/**
 * Verifies that `stated` is the correctly converted value of `amount` at `rate`.
 *
 * Returns the *expected* amount on failure rather than a bare boolean, so the
 * caller can tell someone what the figure should have been instead of only that
 * theirs was wrong. On a screen where the user typed the rate, "expected 92.00"
 * is actionable and "invalid conversion" is not.
 */
export function checkConversion(
  amount: Money,
  rate: Rate,
  stated: Money,
): Result<Money, ConversionMismatch | UnsupportedCurrency | InvalidAmount> {
  const expected = convert(amount, rate, stated.currency);
  if (!expected.ok) {
    return expected;
  }

  if (expected.value.minorUnits !== stated.minorUnits) {
    return err({ kind: "ConversionMismatch", expected: expected.value, stated });
  }

  return ok(expected.value);
}
