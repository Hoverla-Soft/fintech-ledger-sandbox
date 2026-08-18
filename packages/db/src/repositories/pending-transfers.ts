import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "@fintech-ledger-sandbox/core";
import { and, asc, eq, gt, or } from "drizzle-orm";

import type { Db } from "../index";
import { isUniqueViolation } from "../internal/pg-errors";
import { ledgerPendingTransfer } from "../schema/ledger";
import {
  clampPageSize,
  type Page,
  type PageRequest,
  splitPage,
  type TimeCursor,
} from "./pagination";

export type PendingStatus = "pending" | "approved" | "rejected";

export interface PendingPostingWire {
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  readonly amount: string;
  readonly currency: string;
}

export interface PendingTransferRow {
  readonly id: string;
  readonly orgId: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly currency: string;
  readonly postings: readonly PendingPostingWire[];
  readonly status: PendingStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly transactionId: string | null;
  readonly createdAt: Date;
}

export interface InsertPendingInput {
  readonly orgId: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly currency: string;
  readonly postings: readonly PendingPostingWire[];
}

function toRow(row: typeof ledgerPendingTransfer.$inferSelect): PendingTransferRow {
  return {
    id: row.id,
    orgId: row.orgId,
    createdBy: row.createdBy,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    currency: row.currency,
    postings: row.postings as PendingPostingWire[],
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    transactionId: row.transactionId,
    createdAt: row.createdAt,
  };
}

/**
 * Insert or replay a pending transfer under `(orgId, idempotencyKey)`.
 * Same key + same hash → replay existing row. Same key + different hash → conflict.
 */
export async function insertPendingTransfer(
  db: Db,
  input: InsertPendingInput,
): Promise<Result<PendingTransferRow, { kind: "IdempotencyConflict"; idempotencyKey: string }>> {
  try {
    // The insert runs inside its own `transaction(...)` — a real transaction at
    // the top level, a SAVEPOINT when `db` is already one — so that a duplicate
    // key rolls back this statement alone.
    //
    // Without it, the read-back in the `catch` below only works when nothing
    // else has a transaction open: the failed insert aborts its own implicit
    // transaction, which then ends, leaving the connection usable. Inside an
    // enclosing transaction the failure aborts *that*, and the read-back comes
    // back `25P02 current transaction is aborted` rather than reporting the
    // replay it exists to report. Every org-scoped request now has one open
    // (`withOrgScope`), so this is load-bearing rather than defensive.
    //
    // Same shape and same fix as `posting/reserve-key.ts`, whose doc comment
    // covers why a plain blocking insert is preferred to `ON CONFLICT` here.
    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ledgerPendingTransfer)
        .values({
          id: randomUUID(),
          orgId: input.orgId,
          createdBy: input.createdBy,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          currency: input.currency,
          postings: input.postings,
          status: "pending",
        })
        .returning();

      if (row === undefined) {
        throw new Error("insert pending transfer returned no row");
      }
      return row;
    });

    return ok(toRow(inserted));
  } catch (error) {
    // drizzle wraps the pg DatabaseError; plain `"code" in error` misses 23505.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const [existing] = await db
      .select()
      .from(ledgerPendingTransfer)
      .where(
        and(
          eq(ledgerPendingTransfer.orgId, input.orgId),
          eq(ledgerPendingTransfer.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing === undefined) {
      throw error;
    }
    if (existing.requestHash !== input.requestHash) {
      return err({ kind: "IdempotencyConflict", idempotencyKey: input.idempotencyKey });
    }
    return ok(toRow(existing));
  }
}

const DEFAULT_LIMIT = 50;

export type PendingTransferPage = Page<PendingTransferRow, TimeCursor>;

/**
 * The approvals queue for `orgId`, one page at a time.
 *
 * Ordering is **ascending** on `(created_at, id)` — oldest first — so the
 * cursor predicate is `>`, unlike the audit log's `<`. That is not symmetry for
 * its own sake: an approvals queue is FIFO, and the submission that has waited
 * longest is the one most in need of a decision. Newest-first would bury it.
 *
 * This used to be a bare `.limit(100)` with no cursor (`docs/open-questions.md`
 * #29), which is a different thing from "the first hundred": the 101st pending
 * transfer was not on a later page, it was invisible, on the one screen whose
 * entire job is showing what is waiting on you.
 *
 * The existing `(org_id, status, created_at)` index covers the walk. It has no
 * `id` column, matching `ledger_audit_entry_orgId_createdAt_idx`, which omits
 * its tiebreaker too — the tie group at millisecond precision is a handful of
 * rows Postgres sorts after the index scan, not a reason for a migration over a
 * populated table.
 */
export async function listPendingTransfers(
  db: Db,
  orgId: string,
  request: PageRequest<TimeCursor> = {},
  status: PendingStatus = "pending",
): Promise<PendingTransferPage> {
  const limit = clampPageSize(request.limit, DEFAULT_LIMIT);
  const after = request.after;

  const scope = and(
    eq(ledgerPendingTransfer.orgId, orgId),
    eq(ledgerPendingTransfer.status, status),
  );
  const cursorFilter = after
    ? or(
        gt(ledgerPendingTransfer.createdAt, after.createdAt),
        and(
          eq(ledgerPendingTransfer.createdAt, after.createdAt),
          gt(ledgerPendingTransfer.id, after.id),
        ),
      )
    : undefined;

  const rows = await db
    .select()
    .from(ledgerPendingTransfer)
    .where(cursorFilter ? and(scope, cursorFilter) : scope)
    .orderBy(asc(ledgerPendingTransfer.createdAt), asc(ledgerPendingTransfer.id))
    .limit(limit + 1);

  const { pageRows, hasMore, lastRow } = splitPage(rows, limit);

  return {
    items: pageRows.map(toRow),
    nextCursor:
      hasMore && lastRow !== undefined ? { createdAt: lastRow.createdAt, id: lastRow.id } : null,
  };
}

export async function getPendingTransfer(
  db: Db,
  orgId: string,
  pendingId: string,
): Promise<PendingTransferRow | null> {
  const [row] = await db
    .select()
    .from(ledgerPendingTransfer)
    .where(and(eq(ledgerPendingTransfer.orgId, orgId), eq(ledgerPendingTransfer.id, pendingId)));
  return row === undefined ? null : toRow(row);
}

export async function getPendingTransferByKey(
  db: Db,
  orgId: string,
  idempotencyKey: string,
): Promise<PendingTransferRow | null> {
  const [row] = await db
    .select()
    .from(ledgerPendingTransfer)
    .where(
      and(
        eq(ledgerPendingTransfer.orgId, orgId),
        eq(ledgerPendingTransfer.idempotencyKey, idempotencyKey),
      ),
    );
  return row === undefined ? null : toRow(row);
}

export async function markPendingApproved(
  db: Db,
  input: {
    readonly orgId: string;
    readonly pendingId: string;
    readonly decidedBy: string;
    readonly transactionId: string;
  },
): Promise<PendingTransferRow | null> {
  const [updated] = await db
    .update(ledgerPendingTransfer)
    .set({
      status: "approved",
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
      transactionId: input.transactionId,
    })
    .where(
      and(
        eq(ledgerPendingTransfer.orgId, input.orgId),
        eq(ledgerPendingTransfer.id, input.pendingId),
        eq(ledgerPendingTransfer.status, "pending"),
      ),
    )
    .returning();
  return updated === undefined ? null : toRow(updated);
}

export async function markPendingRejected(
  db: Db,
  input: {
    readonly orgId: string;
    readonly pendingId: string;
    readonly decidedBy: string;
  },
): Promise<PendingTransferRow | null> {
  const [updated] = await db
    .update(ledgerPendingTransfer)
    .set({
      status: "rejected",
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(ledgerPendingTransfer.orgId, input.orgId),
        eq(ledgerPendingTransfer.id, input.pendingId),
        eq(ledgerPendingTransfer.status, "pending"),
      ),
    )
    .returning();
  return updated === undefined ? null : toRow(updated);
}
