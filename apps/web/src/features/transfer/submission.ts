import { parseAmount } from "@/lib/ledger/amount";
import { assertBalanced, composeTransfer, type PostingInput } from "@/lib/ledger/postings";

/**
 * Turning a filled-in transfer form into a request payload.
 *
 * Pure, and separated from the component on purpose. This is the step where a
 * wrong answer moves real money in the wrong direction and **no layer below
 * the console will object** — an inverted array still nets to zero, still
 * posts, still reconciles. `docs/development/coding-rules.md` keeps this out
 * of a component; the correctness argument is that a component is the one
 * place this logic could not be exhaustively tested.
 *
 * Everything substantive is delegated to 5a's kernel. This module only
 * sequences the steps and names the failures.
 */

export interface TransferDraft {
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  /** As typed. Never a number — see `docs/adr/0002-money-representation.md`. */
  readonly amount: string;
  readonly currency: string;
}

export type PreparedTransfer =
  | { readonly ok: true; readonly postings: readonly PostingInput[]; readonly minorUnits: bigint }
  | { readonly ok: false; readonly field: "amount" | "source" | "destination" | "form"; readonly message: string };

const AMOUNT_MESSAGES: Record<string, string> = {
  empty: "Enter an amount.",
  too_long: "That amount is too long.",
  malformed: "Enter a plain decimal number, like 12.50.",
  excess_precision: "That is more decimal places than this currency allows.",
  out_of_range: "That amount is larger than this ledger can store.",
  unsupported_currency: "This ledger does not know that currency's decimal scale.",
};

/**
 * Prepares a draft for submission, or explains which field is wrong.
 *
 * Deliberately returns a *field* alongside the message: a rejection that
 * cannot be attached to an input ends up as a floating sentence the user has
 * to map back to a control themselves.
 */
export function prepareTransfer(draft: TransferDraft): PreparedTransfer {
  if (draft.sourceAccountId.length === 0) {
    return { ok: false, field: "source", message: "Choose an account to transfer from." };
  }
  if (draft.destinationAccountId.length === 0) {
    return { ok: false, field: "destination", message: "Choose an account to transfer to." };
  }

  const parsed = parseAmount(draft.amount, draft.currency);
  if (!parsed.ok) {
    return {
      ok: false,
      field: "amount",
      message: AMOUNT_MESSAGES[parsed.problem] ?? "That amount cannot be used.",
    };
  }
  if (parsed.minorUnits <= 0n) {
    return { ok: false, field: "amount", message: "Enter an amount greater than zero." };
  }

  const composed = composeTransfer({
    sourceAccountId: draft.sourceAccountId,
    destinationAccountId: draft.destinationAccountId,
    minorUnits: parsed.minorUnits,
    currency: draft.currency,
  });

  if (!composed.ok) {
    if (composed.problem === "same_account") {
      return {
        ok: false,
        field: "destination",
        message: "Choose a different account to transfer to.",
      };
    }
    if (composed.problem === "non_positive_amount") {
      return { ok: false, field: "amount", message: "Enter an amount greater than zero." };
    }
    return { ok: false, field: "form", message: "This transfer could not be composed." };
  }

  // The last line of defence, run here rather than at the call site so it
  // cannot be forgotten. It re-derives the sum from the array that is actually
  // about to be transmitted, so a bug between the intent and the payload is
  // caught even though every step above already checked.
  assertBalanced(composed.postings);

  return { ok: true, postings: composed.postings, minorUnits: parsed.minorUnits };
}

/**
 * The plain-language sentence shown before submitting.
 *
 * This is the human half of the defence against a balanced-but-inverted array:
 * the machine check proves the legs sum to zero, and this asks a person to
 * confirm the *direction*, which is the part no check below the console can
 * verify. It reads the accounts back by name rather than restating the form's
 * own inputs, so a mis-selected account is visible rather than echoed.
 */
export function describeTransfer(input: {
  readonly sourceName: string;
  readonly destinationName: string;
  readonly amount: string;
  readonly currency: string;
}): string {
  return `Move ${input.amount} ${input.currency} out of ${input.sourceName} and into ${input.destinationName}.`;
}
