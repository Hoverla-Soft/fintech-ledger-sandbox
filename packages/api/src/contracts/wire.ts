import type { Money } from "@fintech-ledger-sandbox/core";
import type {
  AccountReconciliation,
  AuditEntryRow,
  LedgerAccountRow,
  LedgerPostingRow,
  LedgerTransactionRow,
  LedgerTransactionWithPostings,
} from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { moneySchema, toWireMoney, toWireMoneyFromMinorUnits } from "./money";

/**
 * The five response shapes the read surface composes from, and the mappers
 * that build them from repository rows.
 *
 * Output schemas are declared explicitly rather than inferred from handler
 * return types. `ledger.md` names the OpenAPI reference at `/api-reference`
 * as an entry point, and only a declared schema produces a useful document —
 * an inferred one gives the generator nothing to describe.
 *
 * Two rules hold across every mapper here:
 *
 * 1. **`orgId` is never emitted.** Every repository row carries it, and it is
 *    a fact about the caller rather than data worth returning. Echoing it
 *    would also hand a client a value it might be tempted to send back, which
 *    is precisely the input ADR 0005 forbids any procedure from accepting.
 * 2. **Amounts are decimal strings, timestamps are ISO-8601 strings.** No
 *    `bigint` (unserializable — ADR 0002) and no `Date` reaches the wire, so
 *    the payload is plain JSON regardless of which handler serializes it.
 */

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  type: z.enum(["normal", "external"]),
  balance: moneySchema,
  active: z.boolean(),
  createdAt: z.string(),
});

export const postingSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  direction: z.enum(["debit", "credit"]),
  amount: moneySchema,
  createdAt: z.string(),
});

export const transactionSchema = z.object({
  id: z.string(),
  currency: z.string(),
  reversesTransactionId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export const transactionWithPostingsSchema = transactionSchema.extend({
  postings: z.array(postingSchema),
});

export const reconciliationSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  recordedBalance: moneySchema,
  computedBalance: moneySchema,
  reconciled: z.boolean(),
});

export const auditEntrySchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  action: z.string(),
  outcome: z.enum(["posted", "rejected"]),
  reason: z.string().nullable(),
  transactionId: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
});

/**
 * A successful write's response: the transaction, its postings, and the
 * resulting balance of every account it touched (`ledger.md` line 50).
 *
 * `balances` is **current as of this response**, not an as-of-posting
 * snapshot. The distinction only shows up on an idempotent replay: a fresh
 * post computes balances inside its own transaction, whereas a replay re-reads
 * `ledger_account.balance` live, so a retry can legitimately return the same
 * `transactionId` and the same immutable postings alongside *different*
 * balances if other transfers landed in between. Documented here rather than
 * left for the Phase 5 console to discover.
 */
export const postedTransactionSchema = transactionWithPostingsSchema.extend({
  balances: z
    .array(z.object({ accountId: z.string(), balance: moneySchema }))
    .describe(
      "Resulting balance per touched account, current as of this response — on an idempotent replay this reflects the account's balance now, not at the time of the original posting.",
    ),
});

export function toWirePostedTransaction(
  transaction: LedgerTransactionWithPostings,
  balances: ReadonlyMap<string, Money>,
): z.infer<typeof postedTransactionSchema> {
  return {
    ...toWireTransactionWithPostings(transaction),
    balances: [...balances].map(([accountId, balance]) => ({
      accountId,
      balance: toWireMoney(balance),
    })),
  };
}

export function toWireAccount(row: LedgerAccountRow): z.infer<typeof accountSchema> {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    type: row.type,
    balance: toWireMoneyFromMinorUnits(row.balance, row.currency),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWirePosting(row: LedgerPostingRow): z.infer<typeof postingSchema> {
  return {
    id: row.id,
    accountId: row.accountId,
    direction: row.direction,
    amount: toWireMoney(row.amount),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireTransaction(row: LedgerTransactionRow): z.infer<typeof transactionSchema> {
  return {
    id: row.id,
    currency: row.currency,
    reversesTransactionId: row.reversesTransactionId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireTransactionWithPostings(
  row: LedgerTransactionWithPostings,
): z.infer<typeof transactionWithPostingsSchema> {
  return {
    ...toWireTransaction(row),
    postings: row.postings.map(toWirePosting),
  };
}

export function toWireReconciliation(
  row: AccountReconciliation,
): z.infer<typeof reconciliationSchema> {
  return {
    accountId: row.accountId,
    accountName: row.accountName,
    recordedBalance: toWireMoney(row.recordedBalance),
    computedBalance: toWireMoney(row.computedBalance),
    reconciled: row.reconciled,
  };
}

export function toWireAuditEntry(row: AuditEntryRow): z.infer<typeof auditEntrySchema> {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    outcome: row.outcome,
    reason: row.reason,
    transactionId: row.transactionId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}
