import type { Currency } from "./money/currency";
import type { Money } from "./money/money";

/**
 * The typed domain error union for `packages/core`.
 *
 * Every fallible construction/factory in this package returns one of these
 * inside a `Result`, discriminated on `kind`. These carry the context a
 * caller needs to build an API error message in Phase 4 — deliberately no
 * HTTP status codes here; that mapping belongs at the `packages/api`
 * boundary.
 */

export interface CurrencyMismatch {
  readonly kind: "CurrencyMismatch";
  readonly expected: Currency;
  readonly actual: Currency;
}

export interface UnsupportedCurrency {
  readonly kind: "UnsupportedCurrency";
  readonly code: string;
}

export type InvalidAmountReason = "not-a-bigint" | "malformed-decimal" | "excess-precision";

export type InvalidRateReason =
  | "malformed-decimal"
  | "excess-precision"
  | "too-long"
  /** Zero or negative. Neither has a meaning as an exchange rate. */
  | "not-positive";

export interface InvalidRate {
  readonly kind: "InvalidRate";
  readonly reason: InvalidRateReason;
  readonly input: string;
}

export interface InvalidAmount {
  readonly kind: "InvalidAmount";
  readonly reason: InvalidAmountReason;
  readonly input: string;
}

export interface NonPositiveAmount {
  readonly kind: "NonPositiveAmount";
  readonly amount: Money;
}

export interface TooFewPostings {
  readonly kind: "TooFewPostings";
  readonly count: number;
}

export interface UnbalancedTransaction {
  readonly kind: "UnbalancedTransaction";
  readonly net: Money;
}

export interface InsufficientFunds {
  readonly kind: "InsufficientFunds";
  readonly accountId: string;
  readonly balance: Money;
  readonly delta: Money;
  readonly resulting: Money;
}

export type LedgerError =
  | CurrencyMismatch
  | UnsupportedCurrency
  | InvalidAmount
  | InvalidRate
  | NonPositiveAmount
  | TooFewPostings
  | UnbalancedTransaction
  | InsufficientFunds;

export function isLedgerError(
  candidate: unknown,
  kind: LedgerError["kind"],
): candidate is LedgerError {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "kind" in candidate &&
    (candidate as { kind: unknown }).kind === kind
  );
}
