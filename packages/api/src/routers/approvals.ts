import { createPosting, Transaction } from "@fintech-ledger-sandbox/core";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import {
  getPendingTransfer,
  getPendingTransferByKey,
  getTransactionById,
  insertPendingTransfer,
  listPendingTransfers,
  markPendingApproved,
  markPendingRejected,
  type PendingTransferRow,
  recordRejection,
} from "@fintech-ledger-sandbox/db/repositories";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { idempotencyKeySchema } from "../contracts/idempotency";

import { decimalAmountSchema, parseBoundedAmount } from "../contracts/money";
import { computeRequestHash } from "../contracts/request-hash";
import { postedTransactionSchema, toWirePostedTransaction } from "../contracts/wire";
import { toORPCError } from "../errors";
import { adminProcedure, orgProcedure } from "../procedures";

const MAX_POSTINGS = 100;

const pendingPostingSchema = z.object({
  accountId: z.uuid(),
  direction: z.enum(["debit", "credit"]),
  amount: decimalAmountSchema,
  currency: z.string().min(1).max(10),
});

const pendingTransferSchema = z.object({
  id: z.string(),
  createdBy: z.string(),
  currency: z.string(),
  postings: z.array(pendingPostingSchema),
  status: z.enum(["pending", "approved", "rejected"]),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  transactionId: z.string().nullable(),
  createdAt: z.string(),
  replayed: z.boolean(),
});

function toWirePending(row: PendingTransferRow, replayed: boolean) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    currency: row.currency,
    postings: [...row.postings],
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    transactionId: row.transactionId,
    createdAt: row.createdAt.toISOString(),
    replayed,
  };
}

function reasonForDomain(kind: string): string {
  switch (kind) {
    case "TooFewPostings":
      return "too_few_postings";
    case "CurrencyMismatch":
      return "currency_mismatch";
    case "UnbalancedTransaction":
      return "unbalanced_transaction";
    default:
      return "unbalanced_transaction";
  }
}

/**
 * Thin maker-checker for transfers: submit → pending queue → approve/reject
 * by a different admin. Balances only move on approve via `postTransaction`.
 */
export const approvalsRouter = {
  submitPending: adminProcedure
    .input(
      z.object({
        idempotencyKey: idempotencyKeySchema,
        postings: z.array(pendingPostingSchema).max(MAX_POSTINGS),
      }),
    )
    .output(pendingTransferSchema)
    .handler(async ({ context, input }) => {
      const domainPostings = [];
      for (const posting of input.postings) {
        const parsed = parseBoundedAmount(posting.amount, posting.currency);
        if (!parsed.ok) {
          await recordRejection(context.db, {
            orgId: context.orgId,
            actorUserId: context.actorId,
            action: "submit_pending_transfer",
            reason: "invalid_amount",
          });
          throw toORPCError(parsed.error);
        }
        const created = createPosting(posting.accountId, posting.direction, parsed.value);
        if (!created.ok) {
          await recordRejection(context.db, {
            orgId: context.orgId,
            actorUserId: context.actorId,
            action: "submit_pending_transfer",
            reason: "non_positive_amount",
          });
          throw toORPCError(created.error);
        }
        domainPostings.push(created.value);
      }

      const transaction = Transaction.create(domainPostings);
      if (!transaction.ok) {
        await recordRejection(context.db, {
          orgId: context.orgId,
          actorUserId: context.actorId,
          action: "submit_pending_transfer",
          reason: reasonForDomain(transaction.error.kind),
        });
        throw toORPCError(transaction.error);
      }

      const requestHash = computeRequestHash(transaction.value, null);
      const before = await getPendingTransferByKey(context.db, context.orgId, input.idempotencyKey);

      const inserted = await insertPendingTransfer(context.db, {
        orgId: context.orgId,
        createdBy: context.actorId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        currency: transaction.value.currency,
        postings: input.postings.map((posting) => ({
          accountId: posting.accountId,
          direction: posting.direction,
          amount: posting.amount,
          currency: posting.currency,
        })),
      });

      if (!inserted.ok) {
        await recordRejection(context.db, {
          orgId: context.orgId,
          actorUserId: context.actorId,
          action: "submit_pending_transfer",
          reason: "idempotency_conflict",
          metadata: { keyLength: inserted.error.idempotencyKey.length },
        });
        throw toORPCError(inserted.error);
      }

      return toWirePending(inserted.value, before !== null);
    }),

  listPending: orgProcedure
    .input(z.object({}).optional())
    .output(z.object({ pending: z.array(pendingTransferSchema) }))
    .handler(async ({ context }) => {
      const rows = await listPendingTransfers(context.db, context.orgId, "pending");
      return { pending: rows.map((row) => toWirePending(row, false)) };
    }),

  approve: adminProcedure
    /**
     * Takes no `idempotencyKey`, deliberately — it used to, and that was the bug.
     *
     * The key is what stops a posting happening twice, so letting the caller
     * choose it means the caller can opt out of that protection just by sending
     * a different string. It was not a theoretical race either: the Approvals
     * screen minted `crypto.randomUUID()` on every click, so a double-click
     * approved once, posted twice, and left the second transaction orphaned
     * from the pending row it came from. The `status !== "pending"` check below
     * could not catch it, because both calls read the row before either wrote.
     *
     * Deriving the key from `pending.id` moves the guarantee into the database:
     * `UNIQUE (org_id, key)` on the reservation means one pending row can
     * produce at most one transaction, and a second approve *replays* — same
     * `request_hash`, same postings, so it returns the original transaction
     * instead of posting a new one (ADR 0004).
     */
    .input(z.object({ pendingId: z.uuid() }))
    .output(postedTransactionSchema)
    .handler(async ({ context, input }) => {
      const pending = await getPendingTransfer(context.db, context.orgId, input.pendingId);
      if (pending === null || pending.status !== "pending") {
        throw new ORPCError("NOT_FOUND", {
          message: "Pending transfer not found.",
          data: { reason: "pending_not_found" as const },
        });
      }
      if (pending.createdBy === context.actorId) {
        throw new ORPCError("FORBIDDEN", {
          message: "A different admin must approve this transfer.",
          data: { reason: "self_approve_forbidden" as const },
        });
      }

      const domainPostings = [];
      for (const posting of pending.postings) {
        const parsed = parseBoundedAmount(posting.amount, posting.currency);
        if (!parsed.ok) {
          throw toORPCError(parsed.error);
        }
        const created = createPosting(posting.accountId, posting.direction, parsed.value);
        if (!created.ok) {
          throw toORPCError(created.error);
        }
        domainPostings.push(created.value);
      }
      const transaction = Transaction.create(domainPostings);
      if (!transaction.ok) {
        throw toORPCError(transaction.error);
      }

      const posted = await postTransaction(context.db, {
        orgId: context.orgId,
        actorId: context.actorId,
        // Derived, not supplied. One pending row → one key → at most one
        // transaction, enforced by the reservation's unique constraint rather
        // than by the status check above, which two concurrent callers can both
        // pass. The prefix keeps it from colliding with a caller-chosen key on
        // a direct post that happens to be a bare uuid.
        idempotencyKey: `approve:${pending.id}`,
        requestHash: computeRequestHash(transaction.value, null),
        transaction: transaction.value,
      });
      if (!posted.ok) {
        throw toORPCError(posted.error);
      }

      const marked = await markPendingApproved(context.db, {
        orgId: context.orgId,
        pendingId: pending.id,
        decidedBy: context.actorId,
        transactionId: posted.value.transactionId,
      });
      if (marked === null) {
        throw new ORPCError("CONFLICT", {
          message: "This pending transfer was already decided.",
          data: { reason: "pending_already_decided" as const },
        });
      }

      const loaded = await getTransactionById(
        context.db,
        context.orgId,
        posted.value.transactionId,
      );
      if (!loaded.ok) {
        throw new Error("approved transfer posted but is not readable");
      }
      return toWirePostedTransaction(loaded.value, posted.value.balances, posted.value.replayed);
    }),

  reject: adminProcedure
    .input(z.object({ pendingId: z.uuid() }))
    .output(pendingTransferSchema)
    .handler(async ({ context, input }) => {
      const pending = await getPendingTransfer(context.db, context.orgId, input.pendingId);
      if (pending === null || pending.status !== "pending") {
        throw new ORPCError("NOT_FOUND", {
          message: "Pending transfer not found.",
          data: { reason: "pending_not_found" as const },
        });
      }
      if (pending.createdBy === context.actorId) {
        throw new ORPCError("FORBIDDEN", {
          message: "A different admin must reject this transfer.",
          data: { reason: "self_approve_forbidden" as const },
        });
      }

      const marked = await markPendingRejected(context.db, {
        orgId: context.orgId,
        pendingId: pending.id,
        decidedBy: context.actorId,
      });
      if (marked === null) {
        throw new ORPCError("CONFLICT", {
          message: "This pending transfer was already decided.",
          data: { reason: "pending_already_decided" as const },
        });
      }

      await recordRejection(context.db, {
        orgId: context.orgId,
        actorUserId: context.actorId,
        action: "reject_pending_transfer",
        reason: "rejected_by_approver",
        metadata: { pendingId: pending.id },
      });

      return toWirePending(marked, false);
    }),
};
