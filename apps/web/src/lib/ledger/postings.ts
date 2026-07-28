import { asCurrency, formatMinorUnits } from "./amount";

/**
 * Transaction composition — the console's single riskiest responsibility.
 *
 * ADR 0006 chose a raw postings array over a `{source, destination, amount}`
 * shape, so that `too_few_postings` and `unbalanced_transaction` stay
 * reachable rather than becoming structurally impossible and therefore
 * untestable. The stated consequence is that "composing it — including
 * balancing the legs — is now the console's job, not the API's"
 * (`docs/adr/0006-write-endpoint-contract.md:41`). This module is that job,
 * and it is deliberately the only place in the console allowed to do it —
 * `docs/development/coding-rules.md:55` keeps this out of components.
 *
 * ## Why this is the dangerous one
 *
 * An *unbalanced* array is caught: the server returns
 * `422 unbalanced_transaction`. A *balanced but inverted* array is not caught
 * by anything, anywhere. Swap the debit and the credit and money still nets to
 * zero, `Transaction.create` still succeeds, the postings still persist, and
 * the balances still reconcile — they just moved the wrong way. There is no
 * `data.reason` for it because from the server's side nothing is wrong.
 *
 * That makes orientation a fact to be *pinned by a fixture*, not reasoned
 * about at each call site. Both independent sources agree:
 *
 * - `packages/core/src/transaction/posting.ts:32-40` — "debit is positive,
 *   credit is negative", and a balance delta is the signed amount. So a debit
 *   raises an account's balance and a credit lowers it.
 * - `packages/api/src/sandbox/scenarios.ts` `funding` — money entering the
 *   sandbox debits `Operating` (which gains) and credits `Sandbox Funding`
 *   (which goes negative, permitted because it is `external`).
 *
 * Therefore: **money flows out of the credited account and into the debited
 * one.** The destination is debited; the source is credited. `postings.test.ts`
 * asserts this against the `funding` fixture, and asserts that swapping the
 * two produces a different array — because every "it balances" assertion is
 * equally satisfied by a backwards transfer, and so proves nothing on its own.
 */

/** Mirrors `packages/api`'s `transactions.create` input element exactly. */
export interface PostingInput {
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  /** Decimal string, never a number — see `docs/adr/0002-money-representation.md`. */
  readonly amount: string;
  readonly currency: string;
}

/** Bounded by `packages/api/src/routers/transactions.ts:43` so one request cannot demand unbounded row locks. */
export const MAX_POSTINGS = 100;

/** The domain requires at least two legs; `Transaction.create` raises `too_few_postings` below this. */
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

/**
 * Composes the two-leg case: the common transfer.
 *
 * Leg order is destination-first (debit, then credit). The server does not
 * care about order — `Transaction.create` sums the legs — but a stable order
 * makes the array comparable in tests and predictable when rendered back to a
 * user for confirmation.
 */
export function composeTransfer(intent: TransferIntent): Composition {
  // Checked before anything is formatted. `formatMinorUnits` refuses to guess
  // a scale it does not know and returns `"1250 XXX"` instead — correct for
  // display, but as a wire `amount` it is not a decimal string at all. Without
  // this guard the function returned `ok: true` carrying that value, and the
  // failure only surfaced later as a thrown `assertBalanced` rather than a
  // typed rejection the form could render.
  if (asCurrency(intent.currency) === null) {
    return { ok: false, problem: "unsupported_currency" };
  }
  if (intent.minorUnits <= 0n) {
    return { ok: false, problem: "non_positive_amount" };
  }
  // Both legs would hit the same account, netting to zero against itself: a
  // no-op the server would accept and that no user ever means to submit.
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

export interface LegIntent {
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  readonly minorUnits: bigint;
}

/**
 * Composes the N-leg case: payroll runs, marketplace payouts with a fee split.
 *
 * Unlike `composeTransfer`, the caller states each leg's direction, so this
 * cannot infer orientation and instead *verifies* the result balances before
 * returning it. Everything it rejects here is something the server would also
 * reject — the value is that the user finds out before a round trip, with the
 * form still populated.
 */
export function composeLegs(legs: readonly LegIntent[], currency: string): Composition {
  if (asCurrency(currency) === null) {
    return { ok: false, problem: "unsupported_currency" };
  }
  if (legs.length < MIN_POSTINGS) {
    return { ok: false, problem: "too_few_postings" };
  }
  if (legs.length > MAX_POSTINGS) {
    return { ok: false, problem: "too_many_postings" };
  }
  if (legs.some((leg) => leg.minorUnits <= 0n)) {
    return { ok: false, problem: "non_positive_amount" };
  }

  const postings = legs.map(
    (leg): PostingInput => ({
      accountId: leg.accountId,
      direction: leg.direction,
      amount: formatMinorUnits(leg.minorUnits, currency),
      currency,
    }),
  );

  if (signedSum(legs) !== 0n) {
    return { ok: false, problem: "unbalanced" };
  }

  return { ok: true, postings };
}

/** Debit positive, credit negative — the convention `packages/core` materializes balances with. */
function signedSum(legs: readonly LegIntent[]): bigint {
  return legs.reduce(
    (total, leg) => total + (leg.direction === "debit" ? leg.minorUnits : -leg.minorUnits),
    0n,
  );
}

/**
 * The last line of defence, called immediately before a send.
 *
 * Every path that builds postings already checks this, so in correct operation
 * it can never fire. It exists because the cost of being wrong is a real
 * money movement that no downstream layer will question, and re-deriving the
 * sum from the array that is *actually about to be transmitted* — rather than
 * from the intent it was built from — is the only check that survives a bug
 * between the two.
 *
 * Deliberately re-parses the decimal strings rather than trusting the
 * `bigint`s that produced them, so a formatting bug cannot pass unnoticed.
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

  // Every leg is rescaled to one common fraction width before summing.
  //
  // Skipping this would be a false-pass bug, not merely an imprecise one:
  // `"1.0"` and `"10"` both reduce to the digits `10`, so a debit of one unit
  // against a credit of ten would cancel and this function would wave through
  // a transfer that moves nine units of real money. Legs built by the
  // composers above always share a width (`formatMinorUnits` pads to the
  // currency's exponent), but the entire point of this check is to hold when
  // something upstream is wrong.
  const parsed = postings.map((posting) => decomposeDecimal(posting.amount));
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

/** Splits a decimal string into its parts without going through `Number`. */
function decomposeDecimal(decimal: string): {
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
