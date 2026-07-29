import { convert, Money, Rate } from "@fintech-ledger-sandbox/core";

import type { WireAccount } from "@/features/accounts/account-display";
import { asCurrency, formatMinorUnits, parseAmount } from "@/lib/ledger/amount";

/**
 * The console's side of a cross-currency exchange.
 *
 * ## Why this imports `packages/core` rather than reimplementing the arithmetic
 *
 * The server accepts an exchange only when the target amount it is given is the
 * canonical conversion of the amount and rate — `checkConversion` in
 * `packages/core/src/money/exchange.ts`. If the console computed that figure with
 * its own rounding rule, the two would agree for most inputs and disagree for
 * exactly the awkward ones, producing a form that submits a value the server then
 * rejects with no way for the user to tell which side is wrong.
 *
 * So the console runs the *same* `convert`. This mirrors what
 * `lib/ledger/amount.ts` already does for the decimal grammar, and for the same
 * reason: one implementation of the money rules in the system, not a browser copy
 * that can drift.
 *
 * No `Number` appears in the value path here either.
 */

/** Why a would-be exchange cannot be previewed or submitted. */
export type ConversionProblem =
  | "no-source"
  | "no-target"
  | "same-currency"
  | "invalid-amount"
  | "invalid-rate"
  | "unsupported-currency";

export type ConversionPreview =
  | {
      readonly ok: true;
      /** The target amount to submit, as a decimal string at the target currency's scale. */
      readonly targetAmount: string;
      readonly targetCurrency: string;
    }
  | { readonly ok: false; readonly problem: ConversionProblem };

/**
 * What `amount` at `rate` comes to in the target account's currency.
 *
 * Returns the figure the form should both display *and* submit. Displaying one
 * number and sending another is the specific bug this shape prevents — the
 * preview is not a decoration, it is the value the server will verify.
 */
export function previewConversion(
  source: WireAccount | null,
  target: WireAccount | null,
  amountText: string,
  rateText: string,
): ConversionPreview {
  if (source === null) {
    return { ok: false, problem: "no-source" };
  }
  if (target === null) {
    return { ok: false, problem: "no-target" };
  }
  // Refused rather than silently treated as a transfer: the server refuses it
  // too, and a form that quietly changed what it was doing would be worse than
  // one that says no.
  if (source.currency === target.currency) {
    return { ok: false, problem: "same-currency" };
  }

  const targetCurrency = asCurrency(target.currency);
  if (targetCurrency === null) {
    return { ok: false, problem: "unsupported-currency" };
  }

  const parsedAmount = parseAmount(amountText, source.currency);
  if (!parsedAmount.ok) {
    return { ok: false, problem: "invalid-amount" };
  }

  const parsedRate = Rate.parse(rateText);
  if (!parsedRate.ok) {
    return { ok: false, problem: "invalid-rate" };
  }

  const sourceMoney = Money.ofMinorUnits(parsedAmount.minorUnits, source.currency);
  if (!sourceMoney.ok) {
    return { ok: false, problem: "unsupported-currency" };
  }

  const converted = convert(sourceMoney.value, parsedRate.value, targetCurrency);
  if (!converted.ok) {
    return { ok: false, problem: "unsupported-currency" };
  }

  return {
    ok: true,
    targetAmount: formatMinorUnits(converted.value.minorUnits, targetCurrency),
    targetCurrency,
  };
}

/**
 * Accounts a cross-currency exchange may send *to*, given the chosen source.
 *
 * The mirror image of `features/transfer/eligibility.ts`: a transfer requires the
 * currencies to *match*, an exchange requires them to *differ*. Both exclude
 * inactive accounts and the source itself, and both exist to pre-empt a `422`
 * the server would otherwise have to explain.
 *
 * FX bridge accounts are excluded. They are opened automatically to hold the
 * offsetting position, and exchanging directly into one would work but means
 * nothing — it is plumbing, not a destination someone intends.
 */
export function exchangeDestinations(
  accounts: readonly WireAccount[],
  source: WireAccount | null,
): WireAccount[] {
  if (source === null) {
    return [];
  }
  return accounts.filter(
    (account) =>
      account.active &&
      account.currency !== source.currency &&
      account.id !== source.id &&
      !isFxBridge(account),
  );
}

/** Accounts an exchange may send *from* — open, and not plumbing. */
export function exchangeSources(accounts: readonly WireAccount[]): WireAccount[] {
  return accounts.filter((account) => account.active && !isFxBridge(account));
}

/**
 * Whether an exchange is possible at all in this organization: two active
 * non-bridge accounts in *different* currencies.
 *
 * Distinct from `canTransfer`, which needs two in the *same* currency. An org
 * with one USD and one EUR account can exchange but cannot transfer; an org with
 * two USD accounts is the reverse. Saying the right one lets each empty state
 * make a true statement instead of sending someone to create an account they
 * already have.
 */
export function canExchange(accounts: readonly WireAccount[]): boolean {
  const currencies = new Set(
    accounts.filter((account) => account.active && !isFxBridge(account)).map((a) => a.currency),
  );
  return currencies.size >= 2;
}

/** Matches the server's `fxBridgeAccountName`. A rename there has to happen here too. */
export function isFxBridge(account: WireAccount): boolean {
  return account.name.startsWith("FX Bridge ");
}
