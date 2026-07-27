import type { CurrencyMismatch, InsufficientFunds } from "../errors";
import type { Currency } from "../money/currency";
import type { Money } from "../money/money";
import { err, ok, type Result, unwrapInvariant } from "../result";

/** `normal` may never go negative; `external` represents money entering/leaving the sandbox and may. */
export type AccountType = "normal" | "external";

export interface Account {
  readonly id: string;
  readonly orgId: string;
  readonly currency: Currency;
  readonly type: AccountType;
}

/**
 * The pure funds rule. Checks currency agreement across `account.currency`,
 * `balance`, and `delta` *before* evaluating the funds rule, so a
 * wrong-currency delta can never be applied as if it were valid. A `normal`
 * account rejects a resulting balance below zero; an `external` account
 * accepts it. Pure — reading and locking the real balance is `packages/db`'s
 * job (Phase 3).
 */
export function applyDelta(
  account: Account,
  balance: Money,
  delta: Money,
): Result<Money, CurrencyMismatch | InsufficientFunds> {
  if (account.currency !== balance.currency) {
    return err({ kind: "CurrencyMismatch", expected: account.currency, actual: balance.currency });
  }
  if (account.currency !== delta.currency) {
    return err({ kind: "CurrencyMismatch", expected: account.currency, actual: delta.currency });
  }

  const resulting = unwrapInvariant(
    balance.add(delta),
    "balance and delta currency were already confirmed to match the account currency",
  );

  if (account.type === "normal" && resulting.isNegative()) {
    return err({ kind: "InsufficientFunds", accountId: account.id, balance, delta, resulting });
  }

  return ok(resulting);
}
