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
 * The allowlist as an enumerable, ordered, frozen list.
 *
 * `parseCurrency` answers "is this code known?", which is all the domain and
 * the API boundary ever needed — both validate a code someone else supplied.
 * A user interface has the opposite problem: it must *offer* the codes before
 * anyone has typed one, and it cannot do that from a type alias, which is
 * erased at runtime. Added in Phase 5a for the console's currency picker.
 *
 * Derived from `CURRENCY_MINOR_UNIT_EXPONENTS` rather than written out a
 * second time, so a currency can never appear in one and not the other —
 * `currency.test.ts` asserts that agreement in both directions. Ordering is
 * the object's own insertion order: grouped by exponent (2, then 0, then 3),
 * which is also the order a picker should show them in.
 */
export const CURRENCIES: readonly Currency[] = Object.freeze(
  Object.keys(CURRENCY_MINOR_UNIT_EXPONENTS) as Currency[],
);

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
