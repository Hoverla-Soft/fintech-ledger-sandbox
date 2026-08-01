import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "@fintech-ledger-sandbox/core";
import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../index";
import { isUniqueViolation } from "../internal/pg-errors";
import { ledgerPendingTransfer } from "../schema/ledger";

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
    const [inserted] = await db
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

    if (inserted === undefined) {
      throw new Error("insert pending transfer returned no row");
    }
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

export async function listPendingTransfers(
  db: Db,
  orgId: string,
  status: PendingStatus = "pending",
): Promise<readonly PendingTransferRow[]> {
  const rows = await db
    .select()
    .from(ledgerPendingTransfer)
    .where(and(eq(ledgerPendingTransfer.orgId, orgId), eq(ledgerPendingTransfer.status, status)))
    .orderBy(asc(ledgerPendingTransfer.createdAt), asc(ledgerPendingTransfer.id))
    .limit(100);
  return rows.map(toRow);
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
