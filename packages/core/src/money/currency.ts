import type { UnsupportedCurrency } from "../errors";
import { err, ok, type Result } from "../result";

/**
 * Known-exponent currency allowlist (decided 2026-07-27, see ADR 0002).
 *
 * A currency code is usable in this domain only when its ISO-4217
 * minor-unit exponent is known ahead of time — an unrecognized code is
 * rejected, never defaulted to exponent 2, so the domain can never format
 * an amount at a guessed scale. Covers all three real-world exponent
 * scales so every scale is representable and testable:
 * - exponent 2 (hundredths): USD, EUR, GBP, UAH, CHF, PLN
 * - exponent 0 (whole units): JPY, ISK
 * - exponent 3 (thousandths): BHD, KWD
 */
const CURRENCY_MINOR_UNIT_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  UAH: 2,
  CHF: 2,
  PLN: 2,
  JPY: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
} as const satisfies Record<string, 0 | 2 | 3>;

export type Currency = keyof typeof CURRENCY_MINOR_UNIT_EXPONENTS;

/**
 * Parses an arbitrary string into a known `Currency`. Rejects any code
 * whose minor-unit exponent is not on the allowlist above.
 */
export function parseCurrency(code: string): Result<Currency, UnsupportedCurrency> {
  if (Object.hasOwn(CURRENCY_MINOR_UNIT_EXPONENTS, code)) {
    return ok(code as Currency);
  }
  return err({ kind: "UnsupportedCurrency", code });
}

/** The ISO-4217 minor-unit exponent for a known currency. */
export function minorUnitExponent(currency: Currency): number {
  return CURRENCY_MINOR_UNIT_EXPONENTS[currency];
}
