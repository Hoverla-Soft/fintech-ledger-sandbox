import type { CurrencyMismatch, InvalidAmount, UnsupportedCurrency } from "../errors";
import { err, ok, type Result } from "../result";
import { type Currency, minorUnitExponent, parseCurrency } from "./currency";

/**
 * Matches an optional leading `-`, one or more integer digits, and an
 * optional `.` followed by one or more fraction digits. Deliberately
 * rejects `""`, whitespace, `"NaN"`, `"Infinity"`, and exponential notation
 * (`"1e5"`) — none of those match this shape.
 */
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Best-effort, non-throwing stringification of an amount that failed the
 * `typeof === "bigint"` runtime guard, for the `InvalidAmount.input` field.
 */
function describeUnknownAmount(candidate: unknown): string {
  if (typeof candidate === "bigint") {
    return `${candidate}n`;
  }
  if (typeof candidate === "string") {
    return candidate;
  }
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate === "number" ||
    typeof candidate === "boolean"
  ) {
    return String(candidate);
  }
  return Object.prototype.toString.call(candidate);
}

/**
 * A fixed-point monetary amount: integer minor units (`bigint`) plus a
 * known-exponent `Currency`. No `number` anywhere in the amount path, so
 * there is no floating-point rounding to lose money to.
 */
export class Money {
  readonly minorUnits: bigint;
  readonly currency: Currency;

  private constructor(minorUnits: bigint, currency: Currency) {
    this.minorUnits = minorUnits;
    this.currency = currency;
    // `Money` is a value object: every field is `readonly` and every
    // operation (`add`/`subtract`/`negate`) already returns a new instance
    // rather than mutating `this`. `readonly` alone is compile-time only, so
    // freezing here closes the runtime gap (e.g. a cast reassigning
    // `minorUnits` on a `Money` embedded in a posted `Transaction`) at zero
    // behavioural cost — nothing legitimate ever writes to `this` again.
    Object.freeze(this);
  }

  /**
   * Builds a `Money` directly from integer minor units. Runtime-guards
   * `typeof minorUnits === "bigint"` even though the parameter type already
   * says `bigint` — untyped JSON crossing an external boundary is the
   * realistic threat, and this is the last line of defense against a
   * `number` (including an integral one), `NaN`, or a float being coerced
   * into an amount.
   */
  static ofMinorUnits(
    minorUnits: bigint,
    currency: string,
  ): Result<Money, UnsupportedCurrency | InvalidAmount> {
    if (typeof minorUnits !== "bigint") {
      return err({
        kind: "InvalidAmount",
        reason: "not-a-bigint",
        input: describeUnknownAmount(minorUnits),
      });
    }

    const currencyResult = parseCurrency(currency);
    if (!currencyResult.ok) {
      return currencyResult;
    }

    return ok(new Money(minorUnits, currencyResult.value));
  }

  /**
   * Parses a decimal string (e.g. `"12.50"`, `"-3"`) into minor units using
   * the currency's known exponent. Never rounds: a string with more
   * fraction digits than the currency's exponent permits is rejected with
   * `"excess-precision"` rather than truncated or rounded.
   */
  static parse(
    decimal: string,
    currency: string,
  ): Result<Money, UnsupportedCurrency | InvalidAmount> {
    const currencyResult = parseCurrency(currency);
    if (!currencyResult.ok) {
      return currencyResult;
    }

    const match = DECIMAL_PATTERN.exec(decimal);
    if (match === null) {
      return err({ kind: "InvalidAmount", reason: "malformed-decimal", input: decimal });
    }

    const [, signPart, integerPart, fractionPart] = match;
    const exponent = minorUnitExponent(currencyResult.value);
    const fractionDigits = fractionPart ?? "";
    if (fractionDigits.length > exponent) {
      return err({ kind: "InvalidAmount", reason: "excess-precision", input: decimal });
    }

    const combinedDigits = `${integerPart}${fractionDigits.padEnd(exponent, "0")}`;
    const magnitude = BigInt(combinedDigits);
    const minorUnits = signPart === "-" ? -magnitude : magnitude;

    return ok(new Money(minorUnits, currencyResult.value));
  }

  /**
   * Renders this amount as a decimal string, padded to the currency's
   * exponent. Inverse of `parse` — `Money.parse(money.format(), currency)`
   * round-trips to the same `minorUnits`. Renders `-5` minor units of USD
   * as `"-0.05"`, never `"-.05"` or `"0.-05"`.
   */
  format(): string {
    const exponent = minorUnitExponent(this.currency);
    const isNegative = this.minorUnits < 0n;
    const magnitude = isNegative ? -this.minorUnits : this.minorUnits;
    const digits = magnitude.toString().padStart(exponent + 1, "0");
    const sign = isNegative ? "-" : "";

    if (exponent === 0) {
      return `${sign}${digits}`;
    }

    const integerPart = digits.slice(0, digits.length - exponent);
    const fractionPart = digits.slice(digits.length - exponent);
    return `${sign}${integerPart}.${fractionPart}`;
  }

  add(other: Money): Result<Money, CurrencyMismatch> {
    if (this.currency !== other.currency) {
      return err({ kind: "CurrencyMismatch", expected: this.currency, actual: other.currency });
    }
    return ok(new Money(this.minorUnits + other.minorUnits, this.currency));
  }

  subtract(other: Money): Result<Money, CurrencyMismatch> {
    if (this.currency !== other.currency) {
      return err({ kind: "CurrencyMismatch", expected: this.currency, actual: other.currency });
    }
    return ok(new Money(this.minorUnits - other.minorUnits, this.currency));
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  compare(other: Money): Result<-1 | 0 | 1, CurrencyMismatch> {
    if (this.currency !== other.currency) {
      return err({ kind: "CurrencyMismatch", expected: this.currency, actual: other.currency });
    }
    const comparison: -1 | 0 | 1 =
      this.minorUnits < other.minorUnits ? -1 : this.minorUnits > other.minorUnits ? 1 : 0;
    return ok(comparison);
  }

  /** Value equality — same currency and same minor units. Never throws on a currency mismatch; returns `false` instead. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  toString(): string {
    return `${this.format()} ${this.currency}`;
  }
}
