import type { Money } from "@fintech-ledger-sandbox/core";
import type {
  AccountReconciliation,
  AuditEntryRow,
  LedgerAccountRow,
  LedgerPostingRow,
  LedgerTransactionRow,
  LedgerTransactionWithPostings,
  OrgSummary,
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
  reversedBy: z
    .array(z.string())
    .describe(
      "Ids of the transactions that reverse this one — the inverse of `reversesTransactionId`, which points forwards only. Empty when this transaction has not been reversed. An array rather than a boolean because nothing forbids reversing the same transaction twice: there is no unique constraint on the column and `transactions.reverse` performs no existing-reversal check, so a scalar would be correct only until the first double reversal.",
    ),
  fxSourceTransactionId: z
    .string()
    .nullable()
    .describe(
      "On the target leg of a cross-currency exchange, the source leg it was converted from. Null on every other transaction.",
    ),
  fxTargetTransactionId: z
    .string()
    .nullable()
    .describe(
      "On the source leg of a cross-currency exchange, the target leg it converted into. Derived as the inverse of `fxSourceTransactionId`, never stored. A single id rather than a list, because a partial UNIQUE index guarantees one source has at most one target — unlike `reversedBy`, where nothing forbids a second reversal.",
    ),
  fxRate: z
    .string()
    .nullable()
    .describe(
      "The agreed exchange rate as a decimal string, on the target leg of an exchange. A string, never a number: a rate parsed as a float reintroduces the rounding error ADR 0002 exists to prevent.",
    ),
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
  replayed: z
    .boolean()
    .describe(
      "True when this response was served from an idempotency replay (same key + same payload) rather than a fresh post. Balances may still differ from the original response because they are current as of this read.",
    ),
});

export function toWirePostedTransaction(
  transaction: LedgerTransactionWithPostings,
  balances: ReadonlyMap<string, Money>,
  replayed: boolean,
): z.infer<typeof postedTransactionSchema> {
  return {
    ...toWireTransactionWithPostings(transaction),
    balances: [...balances].map(([accountId, balance]) => ({
      accountId,
      balance: toWireMoney(balance),
    })),
    replayed,
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
    // Copied into a fresh array: the repository hands back a `readonly
    // string[]` and the wire type is mutable, so sharing the reference would
    // let a caller mutate what the repository considers immutable.
    reversedBy: [...row.reversedBy],
    fxSourceTransactionId: row.fxSourceTransactionId,
    fxTargetTransactionId: row.fxTargetTransactionId,
    fxRate: row.fxRate,
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

/**
 * The overview aggregate.
 *
 * `normalTotal` and `externalTotal` are returned separately rather than netted:
 * they are exact mirrors, so a single "total balance" would always read `0.00`
 * and look like a bug. Their summing to zero *is* the signal — money is
 * conserved because every transaction is balanced and single-currency.
 */
export const currencyPositionSchema = z.object({
  currency: z.string(),
  accountCount: z.int(),
  normalTotal: moneySchema,
  externalTotal: moneySchema,
});

export const activityPointSchema = z.object({
  date: z.string().describe("UTC calendar day, `YYYY-MM-DD`."),
  currency: z.string(),
  transactionCount: z.int(),
  debitVolume: moneySchema.describe(
    "Sum of the debit legs of that day's transactions. Debits only — a balanced transaction's credits are equal and opposite, so summing both would always be zero.",
  ),
});

export const orgSummarySchema = z.object({
  currencies: z.array(currencyPositionSchema),
  activity: z.array(activityPointSchema),
  totals: z.object({
    accountCount: z.int(),
    transactionCount: z.int(),
    reversalCount: z
      .int()
      .describe(
        "Transactions that reverse another. A reversal is itself a transaction, so this is a subset of `transactionCount`, not a separate population.",
      ),
    rejectionCount: z.int(),
  }),
  activityWindowDays: z.int().describe("How many days back the activity series covers."),
});

export function toWireOrgSummary(
  summary: OrgSummary,
  activityWindowDays: number,
): z.infer<typeof orgSummarySchema> {
  return {
    currencies: summary.currencies.map((position) => ({
      currency: position.currency,
      accountCount: position.accountCount,
      normalTotal: toWireMoneyFromMinorUnits(position.normalTotal, position.currency),
      externalTotal: toWireMoneyFromMinorUnits(position.externalTotal, position.currency),
    })),
    activity: summary.activity.map((point) => ({
      date: point.date,
      currency: point.currency,
      transactionCount: point.transactionCount,
      debitVolume: toWireMoneyFromMinorUnits(point.debitVolume, point.currency),
    })),
    totals: summary.totals,
    activityWindowDays,
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
