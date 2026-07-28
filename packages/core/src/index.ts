/**
 * @fintech-ledger-sandbox/core — the ledger domain.
 *
 * Pure, zero-infrastructure domain logic: the Money value object, the balanced
 * Transaction / posting model, account rules, and the ledger invariants encoded
 * so illegal states are unrepresentable. This package depends on nothing but
 * TypeScript — no runtime dependencies at all, not even a validation library —
 * and is unit-tested with no database.
 *
 * Public API is re-exported from here. Consumers (`packages/api`,
 * `packages/db`) must import only through this entry point — never by
 * reaching into `src/**` directly.
 */

export type { Account, AccountType } from "./account/account";
export { applyDelta } from "./account/account";
export type {
  CurrencyMismatch,
  InsufficientFunds,
  InvalidAmount,
  InvalidAmountReason,
  LedgerError,
  NonPositiveAmount,
  TooFewPostings,
  UnbalancedTransaction,
  UnsupportedCurrency,
} from "./errors";
export { isLedgerError } from "./errors";
export type { Currency } from "./money/currency";
export { CURRENCIES, minorUnitExponent, parseCurrency } from "./money/currency";
export { Money } from "./money/money";
export type { Result } from "./result";
export { err, ok } from "./result";
export type { Posting, PostingDirection } from "./transaction/posting";
export { createPosting, signedAmount } from "./transaction/posting";
export { reverse, Transaction } from "./transaction/transaction";
