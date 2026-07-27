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

/** The full audit log for `orgId`, most recent first. */
export async function listAuditEntries(db: Db, orgId: string, limit?: number): Promise<readonly AuditEntryRow[]> {
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
export async function listRejections(db: Db, orgId: string, limit?: number): Promise<readonly AuditEntryRow[]> {
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
