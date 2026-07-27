import { Money, parseCurrency, type Currency } from "@fintech-ledger-sandbox/core";

/**
 * Rebuilds a known `Currency` from a persisted `text` column. Every
 * currency this package ever writes has already been validated by
 * `packages/core` (a `Money`/`Transaction` cannot exist with an unknown
 * currency), so a parse failure here means the stored value is corrupt or
 * was written outside this package's own write path — an infrastructure
 * bug, not a domain error a caller can recover from, hence the throw
 * rather than a typed `Result`.
 */
export function toCurrency(persistedCurrency: string, context: string): Currency {
  const result = parseCurrency(persistedCurrency);
  if (!result.ok) {
    throw new Error(`${context} has an unrecognized persisted currency "${persistedCurrency}"`);
  }
  return result.value;
}

/**
 * Rebuilds a `Money` value from persisted minor units + currency. Same
 * "this must already be valid" trust boundary as `toCurrency`.
 */
export function toMoney(minorUnits: bigint, persistedCurrency: string, context: string): Money {
  const currency = toCurrency(persistedCurrency, context);
  const result = Money.ofMinorUnits(minorUnits, currency);
  if (!result.ok) {
    throw new Error(`${context} has a malformed persisted amount`);
  }
  return result.value;
}
