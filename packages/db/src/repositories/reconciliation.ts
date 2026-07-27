import type { Money } from "@fintech-ledger-sandbox/core";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../index";
import { toMoney } from "../internal/money";
import { ledgerAccount, ledgerPosting } from "../schema/ledger";

export interface AccountReconciliation {
  readonly accountId: string;
  readonly accountName: string;
  /** The materialized `ledger_account.balance`. */
  readonly recordedBalance: Money;
  /** `signed Σ(postings)` for this account, computed fresh from `ledger_posting`. */
  readonly computedBalance: Money;
  readonly reconciled: boolean;
}

/**
 * Invariant #2: `signed Σ(postings) == account.balance` for every account
 * in `orgId`. The sign convention — debit positive, credit negative —
 * mirrors `core`'s `signedAmount`; `packages/core/src/transaction/
 * posting.ts` documents that this package depends on that convention
 * holding, and this query is that dependency.
 *
 * Aggregates in SQL rather than loading every posting into memory. A
 * `LEFT JOIN` keeps a freshly created, posting-less account in the
 * result set (its sum is `NULL`, treated as zero) instead of silently
 * dropping it, which an `INNER JOIN` would do.
 */
export async function reconcileAccounts(db: Db, orgId: string): Promise<readonly AccountReconciliation[]> {
  const signedSum = sql<string | null>`sum(case when ${ledgerPosting.direction} = 'debit' then ${ledgerPosting.amount} else -${ledgerPosting.amount} end)`;

  const rows = await db
    .select({
      accountId: ledgerAccount.id,
      accountName: ledgerAccount.name,
      currency: ledgerAccount.currency,
      recordedBalance: ledgerAccount.balance,
      computedBalance: signedSum.as("computed_balance"),
    })
    .from(ledgerAccount)
    .leftJoin(ledgerPosting, and(eq(ledgerPosting.accountId, ledgerAccount.id), eq(ledgerPosting.orgId, ledgerAccount.orgId)))
    .where(eq(ledgerAccount.orgId, orgId))
    .groupBy(ledgerAccount.id, ledgerAccount.name, ledgerAccount.currency, ledgerAccount.balance);

  return rows.map((row) => {
    const computedMinorUnits = row.computedBalance === null ? 0n : BigInt(row.computedBalance);
    const recordedBalance = toMoney(row.recordedBalance, row.currency, `ledger_account "${row.accountId}"`);
    const computedBalance = toMoney(computedMinorUnits, row.currency, `ledger_account "${row.accountId}" posting sum`);

    return {
      accountId: row.accountId,
      accountName: row.accountName,
      recordedBalance,
      computedBalance,
      reconciled: recordedBalance.equals(computedBalance),
    };
  });
}
