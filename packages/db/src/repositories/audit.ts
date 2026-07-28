import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../index";
import { ledgerAuditEntry } from "../schema/ledger";

/** Server-controlled cap, same reasoning as `repositories/transactions.ts`. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export interface AuditEntryRow {
  readonly id: string;
  readonly orgId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly outcome: "posted" | "rejected";
  readonly reason: string | null;
  readonly transactionId: string | null;
  readonly metadata: unknown;
  readonly createdAt: Date;
}

export interface RecordRejectionInput {
  readonly orgId: string;
  readonly actorUserId: string;
  /** What was attempted, e.g. `"post_transaction"`. */
  readonly action: string;
  /** Stable machine-readable cause, e.g. `"unbalanced_transaction"`. */
  readonly reason: string;
  /** Structured context. Must contain nothing that could not already be returned to this caller. */
  readonly metadata?: unknown;
}

/**
 * Records a rejected attempt in the audit log.
 *
 * `ledger.md` line 54 requires every rejection to be recorded with a reason,
 * and line 65 lists an audit entry among the write path's side effects. Until
 * Phase 4b only *one* class of rejection actually was: the ones discovered
 * inside `postTransaction` after it had already begun. Two whole classes were
 * silently unrecorded — failures at `Transaction.create` (unbalanced, fewer
 * than two legs, non-positive amount, currency mismatch), which happen in
 * `packages/api` **before** `postTransaction` is ever called, and
 * `IdempotencyConflict`, which returned early without auditing.
 *
 * Deliberately its own top-level write, never joined to a caller's
 * transaction. A rejection audit written inside the transaction that is about
 * to roll back would roll back with it, leaving the log empty exactly when it
 * matters most — the same reasoning ADR 0003 records for
 * `postTransaction`'s own rejection path, which is now implemented on top of
 * this function rather than beside it.
 */
export async function recordRejection(db: Db, input: RecordRejectionInput): Promise<void> {
  await db.insert(ledgerAuditEntry).values({
    id: randomUUID(),
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    action: input.action,
    outcome: "rejected",
    reason: input.reason,
    transactionId: null,
    metadata: input.metadata ?? null,
  });
}

/** The full audit log for `orgId`, most recent first. */
export async function listAuditEntries(
  db: Db,
  orgId: string,
  limit?: number,
): Promise<readonly AuditEntryRow[]> {
  return db
    .select()
    .from(ledgerAuditEntry)
    .where(eq(ledgerAuditEntry.orgId, orgId))
    .orderBy(desc(ledgerAuditEntry.createdAt))
    .limit(clampLimit(limit));
}

/**
 * The "rejections" view — a filtered query against the same audit table,
 * not a second table (`outcome = 'rejected'`).
 */
export async function listRejections(
  db: Db,
  orgId: string,
  limit?: number,
): Promise<readonly AuditEntryRow[]> {
  return db
    .select()
    .from(ledgerAuditEntry)
    .where(and(eq(ledgerAuditEntry.orgId, orgId), eq(ledgerAuditEntry.outcome, "rejected")))
    .orderBy(desc(ledgerAuditEntry.createdAt))
    .limit(clampLimit(limit));
}

function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);
}
