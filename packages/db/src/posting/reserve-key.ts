import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { err, ok, type Result } from "@fintech-ledger-sandbox/core";

import type { IdempotencyConflict } from "../errors";
import { ledgerIdempotencyKey } from "../schema/ledger";
import type { PostingTransaction } from "./types";

/** Postgres SQLSTATE for a unique-constraint violation. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export interface FreshReservation {
  readonly replay: false;
  /** The `ledger_idempotency_key.id` just inserted, for the later `transaction_id` backfill. */
  readonly id: string;
}

export interface ReplayedReservation {
  readonly replay: true;
  readonly transactionId: string | null;
}

export type ReservationOutcome = FreshReservation | ReplayedReservation;

/**
 * Reserves `(orgId, key)` with a plain `INSERT` — deliberately **not**
 * `ON CONFLICT DO NOTHING`. A concurrent duplicate then *blocks* on the
 * unique index until the first committer finishes, and only then surfaces
 * a `23505` unique violation this function turns into a replay/conflict
 * decision. `ON CONFLICT DO NOTHING` would instead return zero rows
 * without blocking, and under READ COMMITTED the loser cannot yet see the
 * uncommitted row — so both callers would proceed and post twice, exactly
 * the race invariant #4 exists to prevent.
 *
 * The insert runs inside a nested `tx.transaction(...)`, which drizzle-orm
 * implements as a Postgres `SAVEPOINT` for an already-open transaction. A
 * unique-violation error only rolls back to that savepoint rather than
 * aborting the whole caller-supplied `tx` (Postgres marks an entire
 * transaction as failed after any error unless the failing statement was
 * inside a savepoint) — so the outer transaction stays usable for the
 * read that follows.
 */
export async function reserveIdempotencyKey(
  tx: PostingTransaction,
  params: { readonly orgId: string; readonly key: string; readonly requestHash: string },
): Promise<Result<ReservationOutcome, IdempotencyConflict>> {
  const id = randomUUID();

  try {
    await tx.transaction(async (savepointTx) => {
      await savepointTx.insert(ledgerIdempotencyKey).values({
        id,
        orgId: params.orgId,
        key: params.key,
        requestHash: params.requestHash,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const [existing] = await tx
      .select()
      .from(ledgerIdempotencyKey)
      .where(and(eq(ledgerIdempotencyKey.orgId, params.orgId), eq(ledgerIdempotencyKey.key, params.key)));

    if (existing === undefined) {
      // The row that caused the violation is gone by the time we read it
      // back. Nothing in this package ever deletes an idempotency key
      // directly (only an org-cascade would), so this should be
      // unreachable — surface the original error rather than reporting a
      // conflict that turned out not to be real.
      throw error;
    }

    if (existing.requestHash !== params.requestHash) {
      return err({ kind: "IdempotencyConflict", idempotencyKey: params.key });
    }

    return ok({ replay: true, transactionId: existing.transactionId });
  }

  return ok({ replay: false, id });
}

function isUniqueViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION;
}

/**
 * Walks the `cause` chain to find a Postgres SQLSTATE code. drizzle-orm
 * wraps every driver error in its own `DrizzleQueryError`, whose `cause`
 * is the raw `pg` `DatabaseError` that actually carries `.code` — a plain
 * `"code" in error` check on the error `reserveIdempotencyKey` catches
 * would never match, since that `code` lives one level deeper. Bounded
 * depth guards against an unexpected circular `cause` chain.
 */
function getPostgresErrorCode(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if ("cause" in error) {
    return getPostgresErrorCode((error as { cause: unknown }).cause, depth + 1);
  }
  return undefined;
}
