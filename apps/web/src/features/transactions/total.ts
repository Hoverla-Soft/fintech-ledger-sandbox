import { formatAmountWithCurrency, parseAmount } from "@/lib/ledger/amount";

/**
 * What a transaction moved, for the history table.
 *
 * ## Why this is a sum of debits and not an `amount` field
 *
 * `transactions.list` returns postings, not a scalar amount, and Phase 6b
 * declined to add one. A balanced transaction may have any number of legs — a
 * split payroll has five — so there is no single "amount" to return. The value
 * that *is* well defined is the total moved, and because every transaction
 * balances (invariant #1), the debit side and the credit side are equal. This
 * sums the debits; summing the credits would give the same number, and if it
 * ever did not, the transaction should never have been posted.
 *
 * ## Why `bigint`
 *
 * `docs/adr/0002-money-representation.md`. Amounts cross the wire as decimal
 * strings and are summed as integer minor units; no `Number` or `parseFloat`
 * appears here, and none may be added. Parsing is delegated to
 * `@/lib/ledger/amount`, which itself delegates to `packages/api`'s parser, so
 * there is exactly one decimal grammar in the system rather than a console
 * copy that can drift from it.
 */

export interface WireAmount {
  readonly amount: string;
  readonly currency: string;
}

export interface WirePosting {
  readonly direction: "debit" | "credit";
  readonly amount: WireAmount;
}

/**
 * Total moved, in minor units, or `null` when it cannot be computed honestly.
 *
 * Returns `null` rather than a partial sum when any posting fails to parse or
 * when the legs disagree on currency. A number that silently omits a leg it
 * could not read would be worse than no number: the row would look
 * authoritative while understating what moved.
 *
 * Mixed currencies cannot occur through `transactions.create` — `Transaction`
 * enforces one currency per transaction — but this reads server data rather
 * than trusting an invariant it does not own, and the cost of checking is one
 * comparison.
 */
export function transactionTotalMinorUnits(postings: readonly WirePosting[]): bigint | null {
  const debits = postings.filter((posting) => posting.direction === "debit");
  if (debits.length === 0) {
    return null;
  }

  let total = 0n;
  for (const posting of debits) {
    if (posting.amount.currency !== debits[0]?.amount.currency) {
      return null;
    }
    const parsed = parseAmount(posting.amount.amount, posting.amount.currency);
    if (!parsed.ok) {
      return null;
    }
    total += parsed.minorUnits;
  }

  return total;
}

/**
 * The history table's amount cell.
 *
 * `null` when the total cannot be computed, so the caller renders an explicit
 * placeholder instead of a misleading `0.00` — "we cannot say" and "nothing
 * moved" are different claims, and only one of them is ever true here.
 */
export function formatTransactionTotal(postings: readonly WirePosting[]): string | null {
  const total = transactionTotalMinorUnits(postings);
  if (total === null) {
    return null;
  }
  const currency = postings.find((posting) => posting.direction === "debit")?.amount.currency;
  return currency === undefined ? null : formatAmountWithCurrency(total, currency);
}
