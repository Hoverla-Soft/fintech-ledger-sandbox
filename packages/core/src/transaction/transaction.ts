import type { CurrencyMismatch, NonPositiveAmount, TooFewPostings, UnbalancedTransaction } from "../errors";
import type { Currency } from "../money/currency";
import { Money } from "../money/money";
import { err, ok, type Result, unwrapInvariant } from "../result";
import type { Posting } from "./posting";
import { signedAmount } from "./posting";

/** A `Transaction` must have at least this many postings — a single-legged posting cannot net to zero. */
const MINIMUM_POSTING_COUNT = 2;

/**
 * An atomic, balanced set of postings. There is no way to hold an
 * unbalanced `Transaction`: the only constructor path is `create`, which
 * validates leg count, currency agreement, positivity, and the zero-sum
 * invariant before a single instance ever exists.
 */
export class Transaction {
  readonly postings: readonly Posting[];
  readonly currency: Currency;

  private constructor(postings: readonly Posting[], currency: Currency) {
    // Defensive copy + freeze, of both the array *and* every element: `postings`
    // may be an array the caller still holds a mutable reference to, and
    // `Posting` is a plain exported interface, so its elements may never have
    // passed through `createPosting`'s own freeze (e.g. `reverse`, below,
    // builds mirrored postings as fresh object literals; test fixtures and
    // other callers can do the same). `readonly Posting[]` only blocks
    // mutation through *this* binding at compile time — it does nothing to
    // stop a caller from `push`/`splice`-ing their own reference, or
    // reassigning a field on an unfrozen element, after construction,
    // silently unbalancing an already-validated `Transaction`. Producers of
    // `Posting` objects cannot be trusted to freeze their own output, so this
    // constructor owns the guarantee itself: copy + freeze each element, then
    // freeze the containing array. Every construction path (including
    // `reverse`, which always goes through `create`) runs through this
    // constructor, so doing it here — once — covers all of them, enforced at
    // runtime rather than only by the type system. `createPosting`'s own
    // freeze stays in place as defense in depth, protecting postings before
    // they ever reach a transaction.
    this.postings = Object.freeze(postings.map((posting) => Object.freeze({ ...posting })));
    this.currency = currency;
  }

  /**
   * Validates, in order: (1) at least `MINIMUM_POSTING_COUNT` postings,
   * (2) every posting shares one currency, (3) every amount is strictly
   * positive, (4) the signed sum (debits positive, credits negative) is
   * exactly zero. Fails on the first violation found.
   */
  static create(
    postings: readonly Posting[],
  ): Result<Transaction, TooFewPostings | CurrencyMismatch | NonPositiveAmount | UnbalancedTransaction> {
    if (postings.length < MINIMUM_POSTING_COUNT) {
      return err({ kind: "TooFewPostings", count: postings.length });
    }

    const firstPosting = postings[0];
    if (firstPosting === undefined) {
      return err({ kind: "TooFewPostings", count: postings.length });
    }
    const currency = firstPosting.amount.currency;

    for (const posting of postings) {
      if (posting.amount.currency !== currency) {
        return err({ kind: "CurrencyMismatch", expected: currency, actual: posting.amount.currency });
      }
    }

    for (const posting of postings) {
      if (!posting.amount.isPositive()) {
        return err({ kind: "NonPositiveAmount", amount: posting.amount });
      }
    }

    let netMinorUnits = 0n;
    for (const posting of postings) {
      netMinorUnits += signedAmount(posting).minorUnits;
    }

    if (netMinorUnits !== 0n) {
      const net = unwrapInvariant(
        Money.ofMinorUnits(netMinorUnits, currency),
        "unbalanced net amount uses the transaction's already-validated currency",
      );
      return err({ kind: "UnbalancedTransaction", net });
    }

    return ok(new Transaction(postings, currency));
  }

  /** The net signed delta (debit positive, credit negative) per `accountId`, aggregating multiple postings against the same account. */
  deltas(): ReadonlyMap<string, Money> {
    const netMinorUnitsByAccount = new Map<string, bigint>();
    for (const posting of this.postings) {
      const existingNet = netMinorUnitsByAccount.get(posting.accountId) ?? 0n;
      netMinorUnitsByAccount.set(posting.accountId, existingNet + signedAmount(posting).minorUnits);
    }

    const deltasByAccount = new Map<string, Money>();
    for (const [accountId, netMinorUnits] of netMinorUnitsByAccount) {
      const netDelta = unwrapInvariant(
        Money.ofMinorUnits(netMinorUnits, this.currency),
        "account delta uses this transaction's already-validated currency",
      );
      deltasByAccount.set(accountId, netDelta);
    }

    return deltasByAccount;
  }
}

/**
 * Produces the mirror of `transaction`: every posting's direction swapped,
 * amounts and accounts unchanged. Swapping direction negates every posting's
 * signed amount, so a balanced input is provably still balanced — a
 * reversal of a valid `Transaction` cannot fail, hence the bare `Transaction`
 * return type rather than a `Result`.
 */
export function reverse(transaction: Transaction): Transaction {
  const reversedPostings: Posting[] = transaction.postings.map((posting) => ({
    accountId: posting.accountId,
    direction: posting.direction === "debit" ? "credit" : "debit",
    amount: posting.amount,
  }));

  return unwrapInvariant(Transaction.create(reversedPostings), "reversing a valid transaction must remain balanced");
}
