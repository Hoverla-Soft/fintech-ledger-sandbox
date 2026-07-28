import { err, ok, type Result } from "@fintech-ledger-sandbox/core";
import { and, eq, inArray } from "drizzle-orm";

import type { AccountInactive, AccountNotFound } from "../errors";
import { ledgerAccount } from "../schema/ledger";
import type { PostingTransaction } from "./types";

export type LockedAccountRow = typeof ledgerAccount.$inferSelect;

/**
 * `SELECT ... FOR UPDATE WHERE org_id = $1 AND id = ANY($2)`, with ids
 * de-duplicated and sorted before locking. Two concurrent transfers that
 * touch the same account pair in opposite directions always acquire the
 * row locks in the same relative order this way, so they can never
 * deadlock against each other.
 *
 * The `org_id` predicate is invariant #5's enforcement point: an account
 * belonging to another org simply never matches a row here, so it is
 * reported as the identical `AccountNotFound` as a genuinely missing id —
 * nothing about another tenant's data ever leaks through this function
 * (`ledger.md` line 56).
 *
 * The `active` check happens here too, and here specifically: the rows are
 * already locked at that point, so a concurrent deactivation cannot slip
 * between the check and the posting. A caller-side pre-check would be racy
 * for exactly that reason. It is reported as its own `AccountInactive`
 * rather than folded into `AccountNotFound` — see the note on that type in
 * `../errors.ts`.
 */
export async function lockAccounts(
  tx: PostingTransaction,
  orgId: string,
  accountIds: readonly string[],
): Promise<Result<ReadonlyMap<string, LockedAccountRow>, AccountNotFound | AccountInactive>> {
  const sortedIds = [...new Set(accountIds)].sort();

  const rows =
    sortedIds.length === 0
      ? []
      : await tx
          .select()
          .from(ledgerAccount)
          .where(and(eq(ledgerAccount.orgId, orgId), inArray(ledgerAccount.id, sortedIds)))
          .for("update");

  const rowsById = new Map(rows.map((row) => [row.id, row]));

  // Two passes, not one, and the order matters. Every id is checked for
  // existence before any is checked for activity, so a caller probing another
  // org's id always gets `AccountNotFound` — never `AccountInactive`, which
  // would confirm the row exists elsewhere.
  for (const accountId of sortedIds) {
    if (!rowsById.has(accountId)) {
      return err({ kind: "AccountNotFound", accountId });
    }
  }

  for (const accountId of sortedIds) {
    if (rowsById.get(accountId)?.active === false) {
      return err({ kind: "AccountInactive", accountId });
    }
  }

  return ok(rowsById);
}
