import {
  createPosting,
  err,
  ok,
  reverse,
  Transaction,
  type Posting,
  type Result,
} from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postTransaction } from "@fintech-ledger-sandbox/db/posting";
import { getTransactionById, listTransactions, recordRejection } from "@fintech-ledger-sandbox/db/repositories";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { cursorSchema, decodeCursor, encodeCursor } from "../contracts/cursor";
import { decimalAmountSchema, parseBoundedAmount } from "../contracts/money";
import { computeRequestHash } from "../contracts/request-hash";
import {
  postedTransactionSchema,
  transactionSchema,
  transactionWithPostingsSchema,
  toWirePostedTransaction,
  toWireTransaction,
  toWireTransactionWithPostings,
} from "../contracts/wire";
import { reasonFor, toORPCError, type LedgerApiError } from "../errors";
import { adminProcedure, orgProcedure } from "../procedures";

/**
 * Transaction and posting reads.
 *
 * `MAX_PAGE_SIZE` is declared here as well as in `packages/db` — deliberately
 * not shared. They enforce different things: this one rejects an unreasonable
 * request at the contract boundary with a `400`, while the repository's own
 * clamp is an unconditional server-side ceiling that holds no matter which
 * caller reaches it. A caller asking for 10_000 gets told so, rather than
 * silently receiving 200 and believing it saw everything.
 */
const MAX_PAGE_SIZE = 200;

/** Bounds how many row locks one request can demand. Well above any realistic payroll or split. */
const MAX_POSTINGS = 100;

interface WriteContext {
  readonly db: Db;
  readonly orgId: string;
  readonly actorId: string;
}

/** Unwraps a posting whose amount was already validated by `Money.parse`; only `NonPositiveAmount` can fail, and `buildTransaction` handles that path. */
function unwrapPosting(result: ReturnType<typeof createPosting>): Posting {
  if (!result.ok) {
    throw new Error(`posting rebuilt from persisted rows is invalid: ${result.error.kind}`);
  }
  return result.value;
}

/**
 * Turns validated wire postings into a domain `Transaction`, surfacing the
 * first domain violation as a typed error.
 *
 * Every rule here lives in `packages/core` and is deliberately not restated:
 * currency validity in `parseCurrency`, precision and format in `Money.parse`,
 * positivity in `createPosting`, and leg count / currency agreement / balance
 * in `Transaction.create`.
 */
function buildTransaction(
  postings: ReadonlyArray<{ accountId: string; direction: "debit" | "credit"; amount: string; currency: string }>,
): Result<Transaction, LedgerApiError> {
  const built: Posting[] = [];

  for (const leg of postings) {
    const amount = parseBoundedAmount(leg.amount, leg.currency);
    if (!amount.ok) {
      return err(amount.error);
    }

    const posting = createPosting(leg.accountId, leg.direction, amount.value);
    if (!posting.ok) {
      return err(posting.error);
    }

    built.push(posting.value);
  }

  const transaction = Transaction.create(built);
  return transaction.ok ? ok(transaction.value) : err(transaction.error);
}

/**
 * Records a rejection that happened *before* persistence was ever attempted.
 *
 * `ledger.md` line 54 requires every rejection to carry a reason, but the
 * validation failures above all occur at `Transaction.create` — before
 * `postTransaction` runs — so its own rejection-audit path never sees them.
 * Without this call those failures would leave no trace at all.
 *
 * Audit failure is swallowed on purpose: the caller is already receiving a
 * correct 4xx for the real problem, and turning a logging failure into a 500
 * would replace an accurate client error with a misleading one. It is logged
 * so the gap is visible rather than silent.
 */
async function recordDomainRejection(
  context: WriteContext,
  action: string,
  error: LedgerApiError,
): Promise<void> {
  try {
    await recordRejection(context.db, {
      orgId: context.orgId,
      actorUserId: context.actorId,
      action,
      reason: reasonFor(error),
      metadata: { kind: error.kind },
    });
  } catch (auditError) {
    console.error({ event: "rejection_audit.failed", action, kind: error.kind }, auditError);
  }
}

/**
 * Posts, then re-reads the committed transaction so the response shape is
 * byte-identical to `transactions.get`'s.
 *
 * `postTransaction` returns a `PostedTransaction` whose postings carry no
 * `created_at`, and the replay path returns a shape built by a different
 * function again. Re-reading costs one indexed lookup and buys a single
 * response shape for fresh posts, replays, and reads alike — worth more to the
 * Phase 5 console than the saved query.
 */
async function postAndLoad(
  context: WriteContext,
  input: { idempotencyKey: string; transaction: Transaction; reversesTransactionId: string | null },
): Promise<z.infer<typeof postedTransactionSchema>> {
  const posted = await postTransaction(context.db, {
    orgId: context.orgId,
    actorId: context.actorId,
    idempotencyKey: input.idempotencyKey,
    requestHash: computeRequestHash(input.transaction, input.reversesTransactionId),
    transaction: input.transaction,
    ...(input.reversesTransactionId === null ? {} : { reversesTransactionId: input.reversesTransactionId }),
  });

  if (!posted.ok) {
    // `postTransaction` already audits everything it rejects internally,
    // including the idempotency conflict — re-recording here would double it.
    throw toORPCError(posted.error);
  }

  const loaded = await getTransactionById(context.db, context.orgId, posted.value.transactionId);
  if (!loaded.ok) {
    throw new Error(`transaction "${posted.value.transactionId}" was posted but is not readable`);
  }

  return toWirePostedTransaction(loaded.value, posted.value.balances);
}

export const transactionsRouter = {
  /**
   * Post a balanced N-leg transaction.
   *
   * Takes raw postings rather than a `{source, destination, amount}` transfer
   * shape, so it maps 1:1 onto `Transaction.create` and no translation layer
   * of ours can introduce an imbalance. It also keeps `too_few_postings` and
   * `unbalanced_transaction` — both published reasons in
   * `docs/backend/error-handling.md` — actually reachable; a transfer shape
   * would make them structurally impossible and therefore untestable.
   */
  create: adminProcedure
    .input(
      z.object({
        idempotencyKey: z.string().min(1).max(200),
        postings: z
          .array(
            z.object({
              accountId: z.uuid(),
              direction: z.enum(["debit", "credit"]),
              amount: decimalAmountSchema,
              currency: z.string().min(1).max(10),
            }),
          )
          // Bounded so a single request cannot demand an unbounded number of
          // row locks. `Transaction.create` enforces the >= 2 rule itself, and
          // that failure must stay reachable, so the floor here is 0.
          .max(MAX_POSTINGS),
      }),
    )
    .output(postedTransactionSchema)
    .handler(async ({ context, input }) => {
      const built = buildTransaction(input.postings);
      if (!built.ok) {
        await recordDomainRejection(context, "post_transaction", built.error);
        throw toORPCError(built.error);
      }

      return postAndLoad(context, {
        idempotencyKey: input.idempotencyKey,
        transaction: built.value,
        reversesTransactionId: null,
      });
    }),

  /**
   * Reverse a transaction: a *new* mirrored transaction linked via
   * `reverses_transaction_id`, never an edit — history is append-only
   * (invariant #8).
   *
   * Two things here are load-bearing. The original is resolved through
   * `getTransactionById(db, orgId, ...)` because `ledger_transaction`'s
   * self-FK is org-blind, so an unscoped lookup would let one tenant reverse
   * another's transaction. And the mirrored legs are rebuilt from the
   * **persisted rows**, never from anything the caller sent — the request
   * carries only an id, so there is nothing to tamper with.
   *
   * Reversing a reversal is deliberately permitted: it re-applies the original
   * effect, nothing in `ledger.md` forbids it, and blocking it by deriving the
   * idempotency key server-side would report a legitimate second reversal as a
   * `409` whose message would be false.
   */
  reverse: adminProcedure
    .input(
      z.object({
        idempotencyKey: z.string().min(1).max(200),
        transactionId: z.uuid(),
      }),
    )
    .output(postedTransactionSchema)
    .handler(async ({ context, input }) => {
      const original = await getTransactionById(context.db, context.orgId, input.transactionId);
      if (!original.ok) {
        throw toORPCError(original.error);
      }

      const rebuilt = Transaction.create(
        original.value.postings.map((posting) =>
          unwrapPosting(createPosting(posting.accountId, posting.direction, posting.amount)),
        ),
      );

      if (!rebuilt.ok) {
        // Unreachable unless persisted history is itself invalid — the rows
        // being mirrored were validated by this same constructor on the way
        // in. Treated as an infrastructure fault, not a client error.
        throw new Error(
          `persisted transaction "${input.transactionId}" does not satisfy the domain invariants: ${rebuilt.error.kind}`,
        );
      }

      return postAndLoad(context, {
        idempotencyKey: input.idempotencyKey,
        transaction: reverse(rebuilt.value),
        reversesTransactionId: input.transactionId,
      });
    }),

  list: orgProcedure
    .input(
      z.object({
        limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
        cursor: cursorSchema.optional(),
      }),
    )
    .output(
      z.object({
        transactions: z.array(transactionSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      // A cursor is opaque, so a malformed one is a bad request, not a
      // server fault. Decoding before the query also keeps an Invalid Date
      // from reaching Drizzle, where it would become SQL NULL and silently
      // return an empty page instead of an error.
      let after;
      if (input.cursor !== undefined) {
        const decoded = decodeCursor(input.cursor);
        if (decoded === null) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Malformed pagination cursor.",
            data: { reason: "invalid_cursor" },
          });
        }
        after = decoded;
      }

      const page = await listTransactions(context.db, {
        orgId: context.orgId,
        limit: input.limit,
        after,
      });

      return {
        transactions: page.items.map(toWireTransaction),
        nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      };
    }),

  /** Same indistinguishable-`404` contract as `accounts.get`. */
  get: orgProcedure
    .input(z.object({ transactionId: z.uuid() }))
    .output(transactionWithPostingsSchema)
    .handler(async ({ context, input }) => {
      const result = await getTransactionById(context.db, context.orgId, input.transactionId);

      if (!result.ok) {
        throw toORPCError(result.error);
      }

      return toWireTransactionWithPostings(result.value);
    }),
};
