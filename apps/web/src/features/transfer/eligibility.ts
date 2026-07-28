import type { WireAccount } from "@/features/accounts/account-display";

/**
 * Which accounts a transfer may name, and why.
 *
 * Pure and separately tested because these filters are doing correctness work,
 * not convenience work: they pre-empt `422 currency_mismatch` and
 * `422 account_inactive` before a round trip. The server still enforces both —
 * the account list is cached and an account can be closed between the fetch
 * and the submit — so the branches stay wired. This just means the common case
 * never has to learn about them.
 */

/** Money can only leave an account that is open. */
export function eligibleSources(accounts: readonly WireAccount[]): WireAccount[] {
  return accounts.filter((account) => account.active);
}

/**
 * Valid destinations for a chosen source.
 *
 * Two exclusions, both of which the server would otherwise reject:
 *
 * - **A different currency.** Every posting in a transaction shares one
 *   currency (invariant #7) and this sandbox does not convert
 *   (`docs/product/requirements/ledger.md` — FX is explicitly out of scope).
 * - **The source itself.** Both legs would hit one account and net to zero
 *   against it: a no-op the server would happily accept and that nobody means
 *   to submit.
 */
export function eligibleDestinations(
  accounts: readonly WireAccount[],
  source: WireAccount | null,
): WireAccount[] {
  if (source === null) {
    return [];
  }
  return accounts.filter(
    (account) => account.active && account.currency === source.currency && account.id !== source.id,
  );
}

/**
 * Whether a transfer is possible at all in this organization.
 *
 * Needs *two* active accounts sharing *one* currency — an org holding only a
 * USD account and only a JPY account has two accounts and can still transfer
 * nothing. Distinguishing this from "no accounts" lets the empty state say
 * something true rather than sending the user to create an account they may
 * already have.
 */
export function canTransfer(accounts: readonly WireAccount[]): boolean {
  const byCurrency = new Map<string, number>();
  for (const account of accounts) {
    if (!account.active) {
      continue;
    }
    byCurrency.set(account.currency, (byCurrency.get(account.currency) ?? 0) + 1);
  }
  return [...byCurrency.values()].some((count) => count >= 2);
}
