import type { NonPositiveAmount } from "../errors";
import type { Money } from "../money/money";
import { err, ok, type Result } from "../result";

export type PostingDirection = "debit" | "credit";

/** One leg of a `Transaction` against one account. Append-only in persistence — never mutated once posted. */
export interface Posting {
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amount: Money;
}

/** Constructs a `Posting`. The amount must be strictly positive — a zero or negative leg is not a valid posting. */
export function createPosting(
  accountId: string,
  direction: PostingDirection,
  amount: Money,
): Result<Posting, NonPositiveAmount> {
  if (!amount.isPositive()) {
    return err({ kind: "NonPositiveAmount", amount });
  }
  // `readonly` on `Posting` is compile-time only — without this, a caller
  // holding the returned reference could still reassign a field (e.g. via a
  // cast) after the posting has been folded into a `Transaction`, silently
  // unbalancing it. Freezing at construction makes the invariant hold at
  // runtime, not just under the type checker.
  return ok(Object.freeze({ accountId, direction, amount }));
}

/**
 * Sign convention: **debit is positive, credit is negative**. This makes
 * `Σ signedAmount(posting) === 0` for a transaction's postings exactly
 * equivalent to `Σ debits === Σ credits` — the "balances reconcile"
 * invariant in `docs/product/requirements/ledger.md`. `packages/db`
 * (Phase 3) depends on this convention holding when it applies deltas to
 * materialized balances.
 */
export function signedAmount(posting: Posting): Money {
  return posting.direction === "debit" ? posting.amount : posting.amount.negate();
}
