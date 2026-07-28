import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";

/**
 * How an account is rendered, in one place, so the list and the detail screen
 * cannot disagree about what a row means.
 */

export interface WireAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly type: "normal" | "external";
  readonly balance: { readonly amount: string; readonly currency: string };
  readonly active: boolean;
  readonly createdAt: string;
}

/**
 * `sandbox.reset` opens these automatically when a reset needs more than one
 * chunk (`docs/adr/0008-sandbox-reset.md`). They are real accounts and are
 * shown rather than filtered out — hiding rows from a ledger view is precisely
 * what this product must not do — but they are labelled, because a user who
 * did not create them should not have to wonder where they came from.
 */
export function isSuspenseAccount(account: WireAccount): boolean {
  return account.type === "external" && account.name.startsWith("Sandbox Suspense ");
}

/**
 * The balance, rendered from the wire string as-is.
 *
 * `accountSchema.balance.amount` has already been formatted by the server's
 * `Money.format()` at the currency's own exponent — a JPY balance arrives as
 * `"0"`, a USD one as `"0.00"`, a BHD one as `"0.000"`. Re-parsing and
 * re-formatting here would create a second formatting path that could disagree
 * with the server's, for no gain.
 *
 * A negative balance is rendered plainly. `external` accounts are *expected*
 * to go negative — that is what makes them the boundary money enters the
 * sandbox through — so this is a normal reading, not an error state.
 */
export function AccountBalance({ account }: { account: WireAccount }) {
  const isNegative = account.balance.amount.startsWith("-");
  // Only a `normal` account going negative is remarkable: invariant #6 makes it
  // impossible, so if one ever renders, it should look wrong.
  const isImpossible = isNegative && account.type === "normal";

  return (
    <span
      data-testid="account-balance"
      className="inline-flex items-baseline justify-end font-mono"
    >
      <span className={isImpossible ? "text-destructive" : undefined}>
        {account.balance.amount}
      </span>
      {/*
        The literal space is load-bearing even though `ml-1.5` draws the visible
        gap: a flex container does not render a whitespace-only text run, so this
        collapses visually while keeping the accessible text one contiguous
        "1234.50 USD" rather than "1234.50USD" for a screen reader.

        The currency itself steps back so the figure is what the eye lands on,
        but it stays at full contrast — this column can hold more than one
        currency at a time, and a code the reader has to hunt for is worse than
        a loud one.
      */}{" "}
      <span className="ml-1.5 text-xs text-muted-foreground">{account.balance.currency}</span>
    </span>
  );
}

export function AccountTypeBadge({ type }: { type: WireAccount["type"] }) {
  return <Badge variant={type === "external" ? "secondary" : "outline"}>{type}</Badge>;
}

export function AccountStatusBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "muted" : "destructive"}>{active ? "active" : "closed"}</Badge>;
}
