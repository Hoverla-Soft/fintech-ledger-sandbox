import {
  type Currency,
  checkConversion,
  createPosting,
  err,
  MAX_RATE_LENGTH,
  ok,
  type Posting,
  Rate,
  type Result,
  reverse,
  Transaction,
} from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import { postExchange, postTransaction } from "@fintech-ledger-sandbox/db/posting";
import {
  createAccount,
  findAccountByName,
  getAccountById,
  getTransactionById,
  type LedgerAccountRow,
  listTransactions,
  recordRejection,
} from "@fintech-ledger-sandbox/db/repositories";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { decodeTimeCursorOrThrow, encodeTimeCursor, pageInputShape } from "../contracts/cursor";
import { decimalAmountSchema, parseBoundedAmount, toWireMoney } from "../contracts/money";
import { computeExchangeRequestHash, computeRequestHash } from "../contracts/request-hash";
import {
  postedTransactionSchema,
  toWirePostedTransaction,
  toWireTransactionWithPostings,
  transactionWithPostingsSchema,
} from "../contracts/wire";
import { type LedgerApiError, reasonFor, toORPCError } from "../errors";
import { adminProcedure, orgProcedure } from "../procedures";

/**
 * Transaction and posting reads.
 *
 * The paging input comes from `contracts/cursor.ts`'s `pageInputShape`, shared
 * with the other four paginated procedures. It used to be declared here; it
 * moved once there was more than one paginated endpoint, so the contract-level
 * `limit` ceiling cannot drift between them. Why that ceiling is *not* shared
 * with `packages/db`'s own clamp is recorded there.
 */

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
  postings: ReadonlyArray<{
    accountId: string;
    direction: "debit" | "credit";
    amount: string;
    currency: string;
  }>,
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
  await recordSimpleRejection(context, action, reasonFor(error), error.kind);
}

/**
 * Records a rejection whose reason is *not* a typed `LedgerApiError`.
 *
 * Two of the exchange rejections have no domain-error counterpart:
 * `same_currency_exchange` is a rule about the request rather than about a
 * transaction, and `ConversionMismatch` is not a `LedgerError` because
 * `packages/core` has no way to know a caller stated an amount at all. They
 * still have to be recorded — `ledger.md` line 54 says *every* rejection is —
 * so this is the shared writer, and `recordDomainRejection` now delegates to it
 * rather than the two paths having separate best-effort logic to drift apart.
 */
async function recordSimpleRejection(
  context: WriteContext,
  action: string,
  reason: string,
  kind = reason,
): Promise<void> {
  try {
    await recordRejection(context.db, {
      orgId: context.orgId,
      actorUserId: context.actorId,
      action,
      reason,
      metadata: { kind },
    });
  } catch (auditError) {
    console.error({ event: "rejection_audit.failed", action, kind }, auditError);
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
    ...(input.reversesTransactionId === null
      ? {}
      : { reversesTransactionId: input.reversesTransactionId }),
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

/**
 * The FX bridge account for one currency, opening it if this org has never
 * exchanged into or out of that currency before.
 *
 * `external` on purpose: the target-side bridge is *credited*, so it goes
 * negative, and invariant #6 forbids that for a `normal` account. External is
 * also the honest type — a bridge is where money leaves the org's own books on
 * the way to another currency, which is exactly what `external` means.
 *
 * Auto-opened rather than demanded of the admin, following the precedent ADR
 * 0008 set for `Sandbox Suspense <CUR>`. The create-then-look-up ordering
 * handles the concurrent case without a racy pre-check: two simultaneous first
 * exchanges in the same currency both attempt the insert, the unique
 * `(org_id, name)` constraint lets exactly one win, and the loser reads the
 * winner's row.
 */
async function findOrOpenFxBridge(
  context: WriteContext,
  currency: Currency,
): Promise<Result<LedgerAccountRow, LedgerApiError>> {
  const name = fxBridgeAccountName(currency);

  const existing = await findAccountByName(context.db, context.orgId, name);
  if (existing !== null) {
    return ok(existing);
  }

  const created = await createAccount(context.db, {
    orgId: context.orgId,
    name,
    currency,
    type: "external",
  });

  if (created.ok) {
    return ok(created.value);
  }

  if (created.error.kind === "AccountAlreadyExists") {
    // Lost the race. The winner's row is now readable.
    const raced = await findAccountByName(context.db, context.orgId, name);
    if (raced !== null) {
      return ok(raced);
    }
  }

  return err(created.error);
}

/** One bridge per currency, named predictably so the console can label it. */
export function fxBridgeAccountName(currency: Currency): string {
  return `FX Bridge ${currency}`;
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

  /**
   * Post a cross-currency exchange: two linked single-currency transactions,
   * committed together.
   *
   * ## Why the caller states the converted amount
   *
   * The rate comes from the caller and so does the resulting amount, and the
   * server verifies they agree. A conversion rarely lands on a whole minor unit
   * — 33.33 USD at 0.92 is 30.6636 EUR — so *someone* has to own the rounding,
   * and ADR 0002's rule is that this ledger never silently reinterprets a
   * figure a person typed. So the caller declares the outcome, the server
   * refuses a figure that cannot be derived from the stated rate, and the
   * rejection carries the expected value in `data.expected` so a form can show
   * what it should have been.
   *
   * ## What the currencies are read from
   *
   * The two accounts, never the input. A currency field here could disagree
   * with the account it names, which would be one more way to get a wrong
   * answer for no benefit.
   */
  exchange: adminProcedure
    .input(
      z.object({
        idempotencyKey: z.string().min(1).max(200),
        fromAccountId: z.uuid(),
        toAccountId: z.uuid(),
        /** In the source account's currency. */
        amount: decimalAmountSchema,
        rate: z.string().min(1).max(MAX_RATE_LENGTH),
        /** In the target account's currency. Verified against `amount × rate`. */
        targetAmount: decimalAmountSchema,
      }),
    )
    .output(
      z.object({
        source: postedTransactionSchema,
        target: postedTransactionSchema,
        rate: z.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const writeContext: WriteContext = {
        db: context.db,
        orgId: context.orgId,
        actorId: context.actorId,
      };

      const [from, to] = await Promise.all([
        getAccountById(context.db, context.orgId, input.fromAccountId),
        getAccountById(context.db, context.orgId, input.toAccountId),
      ]);
      if (!from.ok) {
        throw toORPCError(from.error);
      }
      if (!to.ok) {
        throw toORPCError(to.error);
      }

      // An ordinary transfer dressed as an exchange would open a bridge pair in
      // one currency and post two transactions where one would do — so it is
      // refused rather than quietly accepted.
      if (from.value.currency === to.value.currency) {
        await recordSimpleRejection(writeContext, "post_exchange", "same_currency_exchange");
        throw new ORPCError("UNPROCESSABLE_CONTENT", {
          message:
            "Both accounts hold the same currency, so this is an ordinary transfer rather than an exchange.",
          data: { reason: "same_currency_exchange" as const },
        });
      }

      const sourceAmount = parseBoundedAmount(input.amount, from.value.currency);
      if (!sourceAmount.ok) {
        await recordDomainRejection(writeContext, "post_exchange", sourceAmount.error);
        throw toORPCError(sourceAmount.error);
      }

      const targetAmount = parseBoundedAmount(input.targetAmount, to.value.currency);
      if (!targetAmount.ok) {
        await recordDomainRejection(writeContext, "post_exchange", targetAmount.error);
        throw toORPCError(targetAmount.error);
      }

      const rate = Rate.parse(input.rate);
      if (!rate.ok) {
        await recordDomainRejection(writeContext, "post_exchange", rate.error);
        throw toORPCError(rate.error);
      }

      const conversion = checkConversion(sourceAmount.value, rate.value, targetAmount.value);
      if (!conversion.ok) {
        if (conversion.error.kind !== "ConversionMismatch") {
          await recordDomainRejection(writeContext, "post_exchange", conversion.error);
          throw toORPCError(conversion.error);
        }
        await recordSimpleRejection(writeContext, "post_exchange", "conversion_mismatch");
        throw new ORPCError("UNPROCESSABLE_CONTENT", {
          message:
            "The converted amount does not match the amount and rate given. The expected value is in `data.expected`.",
          data: {
            reason: "conversion_mismatch" as const,
            expected: toWireMoney(conversion.error.expected),
          },
        });
      }

      const [sourceBridge, targetBridge] = await Promise.all([
        findOrOpenFxBridge(writeContext, from.value.currency),
        findOrOpenFxBridge(writeContext, to.value.currency),
      ]);
      if (!sourceBridge.ok) {
        throw toORPCError(sourceBridge.error);
      }
      if (!targetBridge.ok) {
        throw toORPCError(targetBridge.error);
      }

      // Money leaves the payer into the source bridge, then leaves the target
      // bridge into the payee. The bridge pair is left holding the offsetting
      // FX position — `+amount` in the source currency, `-targetAmount` in the
      // target — which is exactly where an FX position belongs.
      const sourceLeg = buildTransaction([
        {
          accountId: sourceBridge.value.id,
          direction: "debit",
          amount: input.amount,
          currency: from.value.currency,
        },
        {
          accountId: from.value.id,
          direction: "credit",
          amount: input.amount,
          currency: from.value.currency,
        },
      ]);
      if (!sourceLeg.ok) {
        await recordDomainRejection(writeContext, "post_exchange", sourceLeg.error);
        throw toORPCError(sourceLeg.error);
      }

      const targetLeg = buildTransaction([
        {
          accountId: to.value.id,
          direction: "debit",
          amount: input.targetAmount,
          currency: to.value.currency,
        },
        {
          accountId: targetBridge.value.id,
          direction: "credit",
          amount: input.targetAmount,
          currency: to.value.currency,
        },
      ]);
      if (!targetLeg.ok) {
        await recordDomainRejection(writeContext, "post_exchange", targetLeg.error);
        throw toORPCError(targetLeg.error);
      }

      const posted = await postExchange(context.db, {
        orgId: context.orgId,
        actorId: context.actorId,
        idempotencyKey: input.idempotencyKey,
        // Both legs plus the rate go into the fingerprint, so retrying the same
        // exchange replays while changing the rate is correctly a conflict.
        requestHash: computeExchangeRequestHash(sourceLeg.value, targetLeg.value, rate.value.text),
        source: sourceLeg.value,
        target: targetLeg.value,
        rate: rate.value.text,
      });

      if (!posted.ok) {
        // `postExchange` audits everything it rejects internally.
        throw toORPCError(posted.error);
      }

      const [sourceLoaded, targetLoaded] = await Promise.all([
        getTransactionById(context.db, context.orgId, posted.value.source.transactionId),
        getTransactionById(context.db, context.orgId, posted.value.target.transactionId),
      ]);
      if (!sourceLoaded.ok || !targetLoaded.ok) {
        throw new Error("an exchange was posted but one of its legs is not readable");
      }

      return {
        source: toWirePostedTransaction(sourceLoaded.value, posted.value.source.balances),
        target: toWirePostedTransaction(targetLoaded.value, posted.value.target.balances),
        rate: rate.value.text,
      };
    }),

  list: orgProcedure
    .input(z.object(pageInputShape))
    .output(
      z.object({
        transactions: z.array(transactionWithPostingsSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      // A cursor is opaque, so a malformed one is a bad request, not a server
      // fault — see `decodeTimeCursorOrThrow`.
      const page = await listTransactions(context.db, {
        orgId: context.orgId,
        limit: input.limit,
        after: decodeTimeCursorOrThrow(input.cursor),
      });

      return {
        transactions: page.items.map(toWireTransactionWithPostings),
        nextCursor: page.nextCursor === null ? null : encodeTimeCursor(page.nextCursor),
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
