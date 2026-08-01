import { asCurrency, formatMinorUnits } from "./amount";

/**
 * Transaction composition — the console's riskiest job (ADR 0006).
 *
 * Orientation: money flows out of the credited account and into the debited
 * one (destination debit, source credit). Pinned by `postings.test.ts` against
 * the `funding` sandbox fixture — a balanced-but-inverted array still posts.
 */

/** Mirrors `packages/api`'s `transactions.create` input element exactly. */
export interface PostingInput {
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  /** Decimal string, never a number — see `docs/adr/0002-money-representation.md`. */
  readonly amount: string;
  readonly currency: string;
}

/** Bounded by `packages/api` so one request cannot demand unbounded row locks. */
export const MAX_POSTINGS = 100;

/** The domain requires at least two legs. */
export const MIN_POSTINGS = 2;

export type CompositionProblem =
  | "non_positive_amount"
  | "same_account"
  | "too_few_postings"
  | "too_many_postings"
  | "unsupported_currency"
  | "unbalanced";

export type Composition =
  | { readonly ok: true; readonly postings: readonly PostingInput[] }
  | { readonly ok: false; readonly problem: CompositionProblem };

export interface TransferIntent {
  /** The account money leaves. Credited. */
  readonly sourceAccountId: string;
  /** The account money arrives in. Debited. */
  readonly destinationAccountId: string;
  readonly minorUnits: bigint;
  readonly currency: string;
}

/** Two-leg transfer. Destination first (debit), then source (credit). */
export function composeTransfer(intent: TransferIntent): Composition {
  if (asCurrency(intent.currency) === null) {
    return { ok: false, problem: "unsupported_currency" };
  }
  if (intent.minorUnits <= 0n) {
    return { ok: false, problem: "non_positive_amount" };
  }
  if (intent.sourceAccountId === intent.destinationAccountId) {
    return { ok: false, problem: "same_account" };
  }

  const amount = formatMinorUnits(intent.minorUnits, intent.currency);

  return {
    ok: true,
    postings: [
      {
        accountId: intent.destinationAccountId,
        direction: "debit",
        amount,
        currency: intent.currency,
      },
      { accountId: intent.sourceAccountId, direction: "credit", amount, currency: intent.currency },
    ],
  };
}

/**
 * Last line before send — re-parses the wire decimals so a formatting bug
 * between intent and payload cannot pass.
 */
export function assertBalanced(postings: readonly PostingInput[]): true {
  if (postings.length < MIN_POSTINGS) {
    throw new Error(
      `Refusing to send ${postings.length} postings; a transaction needs at least ${MIN_POSTINGS}.`,
    );
  }
  if (postings.length > MAX_POSTINGS) {
    throw new Error(
      `Refusing to send ${postings.length} postings; the API accepts at most ${MAX_POSTINGS}.`,
    );
  }

  const currencies = new Set(postings.map((posting) => posting.currency));
  if (currencies.size > 1) {
    throw new Error(
      `Refusing to send postings spanning ${currencies.size} currencies; a transaction is single-currency.`,
    );
  }

  // Rescale to a common width: `"1.0"` and `"10"` both digit-reduce to `10`.
  const parsed = postings.map((posting) => decomposeDecimalStrict(posting.amount));
  const width = parsed.reduce((widest, part) => Math.max(widest, part.fractionDigits.length), 0);

  const total = parsed.reduce((sum, part, index) => {
    const magnitude = BigInt(`${part.integerDigits}${part.fractionDigits.padEnd(width, "0")}`);
    const signed = part.negative ? -magnitude : magnitude;
    return sum + (postings[index]?.direction === "debit" ? signed : -signed);
  }, 0n);

  if (total !== 0n) {
    throw new Error(
      `Refusing to send an unbalanced transaction; debits minus credits is ${total}, not 0.`,
    );
  }

  return true;
}

function decomposeDecimalStrict(decimal: string): {
  readonly negative: boolean;
  readonly integerDigits: string;
  readonly fractionDigits: string;
} {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (match === null) {
    throw new Error(
      `Refusing to send a posting whose amount is not a decimal string: ${JSON.stringify(decimal)}`,
    );
  }
  const [, sign = "", integerDigits = "", fractionDigits = ""] = match;
  return { negative: sign === "-", integerDigits, fractionDigits };
}
