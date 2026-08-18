import type { LedgerError } from "@fintech-ledger-sandbox/core";
import type { PersistenceError } from "@fintech-ledger-sandbox/db/errors";
import { ORPCError } from "@orpc/server";

/**
 * The single translation point from typed domain/persistence errors to HTTP.
 *
 * `packages/core` and `packages/db` both deliberately refuse to know about
 * HTTP — `core/errors.ts` says so explicitly ("deliberately no HTTP status
 * codes here; that mapping belongs at the `packages/api` boundary"). This is
 * that boundary. Every expected failure the ledger can produce arrives here
 * as a discriminated union member and leaves as an `ORPCError` with a stable
 * public code.
 *
 * oRPC's own `COMMON_ERROR_STATUS_MAP` already assigns the statuses
 * `ledger.md` §Error paths asks for — `NOT_FOUND` → 404, `CONFLICT` → 409,
 * `UNPROCESSABLE_CONTENT` → 422 — so no branch below overrides `status`
 * manually. Verified against `@orpc/server`'s documentation during design.
 *
 * **Why the full map lands in Phase 4a when only 404 is reachable:** the read
 * surface can only produce `AccountNotFound` / `TransactionNotFound`. But
 * `docs/backend/error-handling.md` is a 4a deliverable and has to document
 * the complete table, and this is a pure function over a closed union — the
 * `never` assertion below means adding a tenth error kind in a later phase is
 * a compile error here, not a silent 500 in production. Writing half the map
 * now and reopening the doc in 4b costs more than finishing it. The 409/422
 * branches are unit-tested here and wired to live endpoints in 4b.
 */

/** Every expected error the ledger's API surface can translate. */
export type LedgerApiError = LedgerError | PersistenceError;

/**
 * Stable, machine-readable failure codes. These are a public contract: the
 * console (Phase 5) switches on `data.reason`, so a value here may be added
 * to but never renamed without a corresponding client change.
 */
export type LedgerErrorReason =
  | "account_not_found"
  | "account_inactive"
  | "account_name_taken"
  | "transaction_not_found"
  | "idempotency_conflict"
  | "already_reversed"
  | "insufficient_funds"
  | "balance_limit_exceeded"
  | "currency_mismatch"
  | "unsupported_currency"
  | "invalid_amount"
  | "non_positive_amount"
  | "too_few_postings"
  | "unbalanced_transaction"
  | "invalid_rate"
  | "conversion_mismatch"
  | "same_currency_exchange";

/**
 * Messages are fixed strings, never interpolated with the offending value.
 *
 * Two reasons. A cross-org `accountId` echoed back would confirm the id's
 * shape to a caller probing another tenant, and `ledger.md` line 56 requires
 * that a cross-org lookup reveal nothing. And an interpolated database or
 * driver message is exactly the internal detail `docs/backend/error-handling.md`
 * forbids returning. Callers that need specifics get them from the typed
 * `reason`, not from prose.
 */
const MESSAGES: Record<LedgerErrorReason, string> = {
  account_not_found: "Account not found.",
  account_inactive: "That account is inactive and cannot be posted to.",
  account_name_taken: "An account with that name already exists in this organization.",
  transaction_not_found: "Transaction not found.",
  already_reversed: "This transaction has already been reversed.",
  idempotency_conflict: "This idempotency key was already used with a different request payload.",
  insufficient_funds: "The source account has insufficient funds for this transfer.",
  balance_limit_exceeded:
    "This posting would take an account balance beyond the largest value the ledger can store.",
  currency_mismatch: "All postings in a transaction must share one currency.",
  unsupported_currency: "That currency is not supported.",
  invalid_amount: "The amount is not a valid monetary value.",
  non_positive_amount: "Every posting amount must be greater than zero.",
  too_few_postings: "A transaction requires at least two postings.",
  unbalanced_transaction: "The transaction's postings do not net to zero.",
  invalid_rate: "The exchange rate is not a valid positive decimal.",
  conversion_mismatch:
    "The converted amount does not match the amount and rate given. The expected value is in `data.expected`.",
  same_currency_exchange:
    "Both accounts hold the same currency, so this is an ordinary transfer rather than an exchange.",
};

/**
 * Maps a typed ledger error onto its oRPC code and public reason.
 *
 * `AccountNotFound` and `TransactionNotFound` both become a plain `404` that
 * is byte-identical whether the id is genuinely missing or belongs to another
 * organization — `packages/db/src/errors.ts` makes the two indistinguishable
 * on purpose, and undoing that here would leak tenant existence through the
 * error channel. Note that `403` is never produced by this function: role and
 * membership denial happens in middleware, before a handler runs. A `403`
 * must never be the signal that a resource exists in another tenant.
 */
function classify(error: LedgerApiError): { code: string; reason: LedgerErrorReason } {
  switch (error.kind) {
    case "AccountNotFound":
      return { code: "NOT_FOUND", reason: "account_not_found" };
    // Not a 404. The indistinguishability rule protects against *cross-tenant*
    // existence leaks; within the caller's own org there is nothing to hide,
    // and `accounts.list` already reports `active` on every account — so a 404
    // here would contradict what the same caller was just told.
    case "AccountInactive":
      return { code: "UNPROCESSABLE_CONTENT", reason: "account_inactive" };
    // 409, matching the system's only other uniqueness conflict: a taken name
    // is a collision with existing state, not a malformed request.
    case "AccountAlreadyExists":
      return { code: "CONFLICT", reason: "account_name_taken" };
    case "TransactionNotFound":
      return { code: "NOT_FOUND", reason: "transaction_not_found" };
    case "IdempotencyConflict":
      return { code: "CONFLICT", reason: "idempotency_conflict" };
    // 409 for the same reason `AccountAlreadyExists` is: a collision with
    // existing state, not a malformed request. The caller's payload was fine —
    // someone already reversed this transaction, possibly between their read
    // and their write.
    case "TransactionAlreadyReversed":
      return { code: "CONFLICT", reason: "already_reversed" };
    case "InsufficientFunds":
      return { code: "UNPROCESSABLE_CONTENT", reason: "insufficient_funds" };
    // 422 alongside the other domain refusals, not a 500. The request is
    // well-formed and every individual amount is storable; what it asks for is
    // a balance the ledger cannot hold. Open question #27: this was the only
    // refusal here that reached the caller as an unmapped driver error, which
    // made it the only one the audit log could not explain.
    case "BalanceLimitExceeded":
      return { code: "UNPROCESSABLE_CONTENT", reason: "balance_limit_exceeded" };
    case "CurrencyMismatch":
      return { code: "UNPROCESSABLE_CONTENT", reason: "currency_mismatch" };
    case "UnsupportedCurrency":
      return { code: "UNPROCESSABLE_CONTENT", reason: "unsupported_currency" };
    case "InvalidAmount":
      return { code: "UNPROCESSABLE_CONTENT", reason: "invalid_amount" };
    case "NonPositiveAmount":
      return { code: "UNPROCESSABLE_CONTENT", reason: "non_positive_amount" };
    case "TooFewPostings":
      return { code: "UNPROCESSABLE_CONTENT", reason: "too_few_postings" };
    case "UnbalancedTransaction":
      return { code: "UNPROCESSABLE_CONTENT", reason: "unbalanced_transaction" };
    case "InvalidRate":
      return { code: "UNPROCESSABLE_CONTENT", reason: "invalid_rate" };
    default: {
      // Exhaustiveness guard: if `LedgerError` or `PersistenceError` gains a
      // member, this stops compiling instead of falling through to a 500.
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * The stable public reason for an error, without building an `ORPCError`.
 *
 * Used when a rejection must be *recorded* as well as returned, so the audit
 * log and the HTTP response name the same cause with the same string. Deriving
 * both from `classify` means the two can never drift.
 */
export function reasonFor(error: LedgerApiError): LedgerErrorReason {
  return classify(error).reason;
}

/** Translates a typed ledger error into the `ORPCError` to throw from a handler. */
export function toORPCError(
  error: LedgerApiError,
): ORPCError<string, { reason: LedgerErrorReason }> {
  const { code, reason } = classify(error);
  return new ORPCError(code, {
    message: MESSAGES[reason],
    data: { reason },
  });
}
