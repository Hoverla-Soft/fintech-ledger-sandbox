import { randomUUID } from "node:crypto";

import {
  type Account,
  applyDelta,
  type Currency,
  type CurrencyMismatch,
  err,
  type InsufficientFunds,
  type LedgerError,
  type Money,
  ok,
  type PostingDirection,
  type Result,
  type Transaction,
} from "@fintech-ledger-sandbox/core";
import { and, eq, inArray } from "drizzle-orm";
import type {
  AccountInactive,
  AccountNotFound,
  IdempotencyConflict,
  TransactionAlreadyReversed,
} from "../errors";
import type { Db } from "../index";
import { toCurrency, toMoney } from "../internal/money";
import { getPostgresConstraint, isUniqueViolation } from "../internal/pg-errors";
import { recordRejection } from "../repositories/audit";
import {
  ledgerAccount,
  ledgerAuditEntry,
  ledgerIdempotencyKey,
  ledgerPosting,
  ledgerTransaction,
} from "../schema/ledger";
import { lockAccounts } from "./lock-accounts";
import { reserveIdempotencyKey } from "./reserve-key";
import type { PostingTransaction } from "./types";

export interface PostedPosting {
  readonly id: string;
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amount: Money;
}

export interface PostedTransaction {
  readonly transactionId: string;
  readonly orgId: string;
  readonly currency: Currency;
  readonly createdAt: Date;
  readonly reversesTransactionId: string | null;
  readonly postings: readonly PostedPosting[];
  /** Resulting balance per account id, for every account this transaction touched. */
  readonly balances: ReadonlyMap<string, Money>;
  /**
   * True when this result was served from an idempotency replay rather than a
   * fresh post. Open question #4 — without this flag the wire response cannot
   * tell a client whether money moved again.
   */
  readonly replayed: boolean;
}

export interface PostTransactionInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly transaction: Transaction;
  /**
   * Links this transaction to the one it reverses (`ledger_transaction`'s
   * self-FK). Optional — most transactions reverse nothing. The domain
   * `Transaction` produced by `core.reverse(original)` carries only
   * mirrored postings, not `original`'s id, so a caller building a
   * reversal must pass it explicitly here for invariant #8's linkage to
   * be recorded at all.
   */
  readonly reversesTransactionId?: string;
}

/** Everything `postTransaction` can fail with: this package's own persistence errors, unioned with core's domain error union. */
export type PostTransactionError =
  | AccountNotFound
  | AccountInactive
  | IdempotencyConflict
  | TransactionAlreadyReversed
  | LedgerError;

/** The subset of domain errors that can actually surface from *inside* the locked section of the routine below. */
type DomainRejectionReason =
  | AccountNotFound
  | AccountInactive
  | CurrencyMismatch
  | InsufficientFunds
  | TransactionAlreadyReversed;

/**
 * Thrown from inside the `db.transaction(...)` callback to force a full
 * Postgres rollback on an expected domain-rule failure (insufficient
 * funds, unknown/cross-org account, currency mismatch) — Drizzle's
 * transaction wrapper only rolls back when its callback throws. This is a
 * typed sentinel carrying the *expected* rejection reason, kept distinct
 * from a real infrastructure error so the `catch` below never confuses
 * the two (see the "Rejection handling" note in
 * `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`).
 */
class DomainRejection extends Error {
  readonly reason: DomainRejectionReason;

  constructor(reason: DomainRejectionReason) {
    super(`ledger transaction rejected: ${reason.kind}`);
    this.name = "DomainRejection";
    this.reason = reason;
  }
}

type TransactionOutcome =
  | { readonly kind: "conflict"; readonly error: IdempotencyConflict }
  | { readonly kind: "replay"; readonly transactionId: string }
  | { readonly kind: "posted"; readonly posted: PostedTransaction };

/** What one leg needs beyond the balanced `Transaction` itself. */
interface ApplyLegInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly transaction: Transaction;
  readonly reversesTransactionId?: string;
  /** Set on the target leg of an exchange, pointing at the source leg. */
  readonly fxSourceTransactionId?: string;
  /** The agreed rate, as text. Set on the target leg of an exchange only. */
  readonly fxRate?: string;
}

/**
 * Posts one balanced transaction inside an already-open Postgres transaction:
 * lock the accounts it touches, apply every delta through `core.applyDelta`,
 * insert the transaction and its postings, update balances, and write the
 * "posted" audit entry.
 *
 * Extracted from `postTransaction` in Phase 7c so `postExchange` can post **two**
 * legs under one commit and one idempotency key without a second copy of the
 * posting routine. Everything idempotency-related deliberately stays outside:
 * a leg is not independently replayable, and one exchange must reserve one key,
 * not two.
 *
 * Throws `DomainRejection` for an expected domain failure rather than returning
 * a `Result`, because the whole Postgres transaction has to roll back and
 * Drizzle only rolls back when its callback throws. The public functions catch
 * it and convert.
 */
async function applyLeg(tx: PostingTransaction, input: ApplyLegInput): Promise<PostedTransaction> {
  const accountIds = [...input.transaction.deltas().keys()];
  const lockResult = await lockAccounts(tx, input.orgId, accountIds);
  if (!lockResult.ok) {
    throw new DomainRejection(lockResult.error);
  }
  const lockedAccounts = lockResult.value;

  const resultingBalances = new Map<string, Money>();
  for (const [accountId, delta] of input.transaction.deltas()) {
    const row = lockedAccounts.get(accountId);
    if (row === undefined) {
      throw new Error(
        `locked account "${accountId}" missing after lockAccounts reported every id present`,
      );
    }

    const account: Account = {
      id: row.id,
      orgId: row.orgId,
      currency: toCurrency(row.currency, `ledger_account "${row.id}"`),
      type: row.type,
    };
    const balance = toMoney(row.balance, row.currency, `ledger_account "${row.id}"`);

    const applied = applyDelta(account, balance, delta);
    if (!applied.ok) {
      throw new DomainRejection(applied.error);
    }

    resultingBalances.set(accountId, applied.value);
  }

  const transactionId = randomUUID();
  let insertedTransaction: typeof ledgerTransaction.$inferSelect | undefined;
  try {
    [insertedTransaction] = await tx
      .insert(ledgerTransaction)
      .values({
        id: transactionId,
        orgId: input.orgId,
        currency: input.transaction.currency,
        reversesTransactionId: input.reversesTransactionId ?? null,
        fxSourceTransactionId: input.fxSourceTransactionId ?? null,
        fxRate: input.fxRate ?? null,
        createdBy: input.actorId,
      })
      .returning();
  } catch (error) {
    // The partial unique index on `reverses_transaction_id` (migration 0007)
    // is what makes "a transaction is reversible at most once" a fact rather
    // than a convention. Turning its violation into a typed rejection matters
    // for the same reason every other refusal here is typed: an unmapped
    // `23505` would surface as a 500, and a 500 is the one outcome this
    // ledger's audit trail cannot explain.
    //
    // The constraint name is checked, not just the SQLSTATE. `ledger_transaction`
    // carries a *second* partial unique index — `fxSourceTransactionId` — and
    // reporting an FX pairing bug as "already reversed" would send whoever
    // debugs it to the wrong half of the file.
    if (
      isUniqueViolation(error) &&
      getPostgresConstraint(error) === "ledger_transaction_reversesTransactionId_idx"
    ) {
      throw new DomainRejection({
        kind: "TransactionAlreadyReversed",
        transactionId: input.reversesTransactionId ?? "",
      });
    }
    throw error;
  }

  if (insertedTransaction === undefined) {
    throw new Error(`insert into ledger_transaction "${transactionId}" returned no row`);
  }

  const insertedPostings = await tx
    .insert(ledgerPosting)
    .values(
      input.transaction.postings.map((posting) => ({
        id: randomUUID(),
        orgId: input.orgId,
        transactionId,
        accountId: posting.accountId,
        direction: posting.direction,
        amount: posting.amount.minorUnits,
        currency: posting.amount.currency,
      })),
    )
    .returning();

  for (const [accountId, balance] of resultingBalances) {
    await tx
      .update(ledgerAccount)
      .set({ balance: balance.minorUnits })
      .where(and(eq(ledgerAccount.id, accountId), eq(ledgerAccount.orgId, input.orgId)));
  }

  await tx.insert(ledgerAuditEntry).values({
    id: randomUUID(),
    orgId: input.orgId,
    actorUserId: input.actorId,
    action: "post_transaction",
    outcome: "posted",
    transactionId,
    metadata: null,
  });

  return {
    transactionId,
    orgId: input.orgId,
    currency: input.transaction.currency,
    createdAt: insertedTransaction.createdAt,
    reversesTransactionId: insertedTransaction.reversesTransactionId,
    postings: insertedPostings.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      direction: row.direction,
      amount: toMoney(row.amount, row.currency, `ledger_posting "${row.id}"`),
    })),
    balances: resultingBalances,
    replayed: false,
  };
}

/**
 * The atomic posting routine — the only public write path into the
 * ledger. Runs steps 1-4 of the design's posting routine inside **one**
 * Postgres transaction (reserve idempotency key → lock accounts, ordered
 * → apply deltas through `core.applyDelta` → insert transaction/postings,
 * update balances, backfill the idempotency row, write the "posted"
 * audit entry), and commits all of it or none of it.
 *
 * A domain rejection (insufficient funds, unknown/cross-org account,
 * currency mismatch) rolls the whole transaction back, then records a
 * *separate* "rejected" audit entry in its own transaction — an audit row
 * written inside the failing transaction would roll back with it, which
 * would silently leave `ledger.md`'s "every rejection is recorded"
 * requirement unmet.
 */
export async function postTransaction(
  db: Db,
  input: PostTransactionInput,
): Promise<Result<PostedTransaction, PostTransactionError>> {
  let outcome: TransactionOutcome;

  try {
    outcome = await db.transaction(async (tx): Promise<TransactionOutcome> => {
      const reservation = await reserveIdempotencyKey(tx, {
        orgId: input.orgId,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
      });

      if (!reservation.ok) {
        return { kind: "conflict", error: reservation.error };
      }

      if (reservation.value.replay) {
        const { transactionId } = reservation.value;
        if (transactionId === null) {
          // A durably committed idempotency key row only ever exists once
          // its owning transaction backfilled `transaction_id` in the
          // same commit (see `schema/ledger.ts`) — a rejected attempt
          // rolls the reservation back with everything else, so it never
          // persists at all. A null `transaction_id` on a row we can read
          // here is therefore a real data-integrity bug, not a domain
          // rejection a caller can retry past.
          throw new Error(
            `idempotency key "${input.idempotencyKey}" for org "${input.orgId}" was reserved but never backfilled with a transaction id`,
          );
        }
        return { kind: "replay", transactionId };
      }

      const posted = await applyLeg(tx, input);

      await tx
        .update(ledgerIdempotencyKey)
        .set({ transactionId: posted.transactionId })
        .where(eq(ledgerIdempotencyKey.id, reservation.value.id));

      return { kind: "posted", posted };
    });
  } catch (caught) {
    if (caught instanceof DomainRejection) {
      await writeRejectionAudit(db, input, caught.reason);
      return err(caught.reason);
    }
    throw caught;
  }

  if (outcome.kind === "conflict") {
    // `ledger.md` line 54 requires every rejection to be recorded, and a
    // reused key with a changed payload is a rejection like any other. This
    // branch previously returned without auditing, so the one failure a
    // client is most likely to retry into left no trace at all.
    await auditBestEffort(db, {
      orgId: input.orgId,
      actorUserId: input.actorId,
      action: "post_transaction",
      reason: "idempotency_conflict",
      // Deliberately NOT the caller's raw key. `reserveIdempotencyKey` reports
      // back the string it was given, and this column is `jsonb` — a key
      // containing an unpaired surrogate serializes to invalid JSON and
      // Postgres rejects the insert with 22P02. Recording the key's shape
      // rather than its bytes keeps a client-supplied string out of a jsonb
      // document entirely.
      metadata: { kind: outcome.error.kind, keyLength: outcome.error.idempotencyKey.length },
    });
    return err(outcome.error);
  }

  if (outcome.kind === "replay") {
    return ok(await loadPostedTransaction(db, input.orgId, outcome.transactionId));
  }

  return ok(outcome.posted);
}

export interface PostExchangeInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  /** Balanced in the source currency: the payer credited, the source FX bridge debited. */
  readonly source: Transaction;
  /** Balanced in the target currency: the target FX bridge credited, the payee debited. */
  readonly target: Transaction;
  /** The agreed rate, as text. Recorded on the target leg. */
  readonly rate: string;
}

export interface PostedExchange {
  readonly source: PostedTransaction;
  readonly target: PostedTransaction;
}

/**
 * Posts a cross-currency exchange as **two linked single-currency transactions**,
 * in one commit, under one idempotency key.
 *
 * ## Why two transactions and not one multi-currency one
 *
 * Because everything already built stays true. `Transaction` keeps its
 * single-currency invariant, so `Transaction.create` is unchanged and
 * `CurrencyMismatch` still means what it meant. `ledger_transaction.currency`
 * stays single-valued. Reconciliation is untouched. And per-currency
 * conservation still holds — each leg nets to zero within its own currency, so
 * the sum of all balances in a currency is still zero. The FX position lives
 * where it belongs: as offsetting balances on the two bridge accounts.
 *
 * The alternative — relaxing the core invariant to "balanced per currency" —
 * would have changed the domain, the schema, reconciliation, and every currency
 * test, and left the FX gain or loss with no account to sit in. See
 * `docs/adr/0010-cross-currency-exchange.md`.
 *
 * ## Atomicity
 *
 * Both legs run inside one `db.transaction`, so a failure on the target leg rolls
 * the source leg back with it. A half-completed exchange would leave money in a
 * bridge account with nothing to say where it was going — the one outcome this
 * function exists to make impossible.
 *
 * ## Why the union of accounts is locked before either leg posts
 *
 * `applyLeg` locks the accounts *its own* leg touches, and `lockAccounts` sorts
 * ids so concurrent transfers can never deadlock. Two sequential locks break
 * that guarantee: a USD→EUR exchange would take `{payer, bridge USD}` then
 * `{bridge EUR, payee}`, while a concurrent EUR→USD exchange takes them in the
 * opposite order — a textbook deadlock. Locking the union up front, in one sorted
 * call, restores a single global ordering. The per-leg locks that follow are then
 * re-locks of rows this transaction already holds, which is free.
 */
export async function postExchange(
  db: Db,
  input: PostExchangeInput,
): Promise<Result<PostedExchange, PostTransactionError>> {
  let outcome:
    | { readonly kind: "conflict"; readonly error: IdempotencyConflict }
    | { readonly kind: "replay"; readonly transactionId: string }
    | { readonly kind: "posted"; readonly posted: PostedExchange };

  try {
    outcome = await db.transaction(async (tx) => {
      const reservation = await reserveIdempotencyKey(tx, {
        orgId: input.orgId,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
      });

      if (!reservation.ok) {
        return { kind: "conflict", error: reservation.error } as const;
      }

      if (reservation.value.replay) {
        const { transactionId } = reservation.value;
        if (transactionId === null) {
          throw new Error(
            `idempotency key "${input.idempotencyKey}" for org "${input.orgId}" was reserved but never backfilled with a transaction id`,
          );
        }
        return { kind: "replay", transactionId } as const;
      }

      // See the locking note above — one sorted lock over both legs' accounts.
      const allAccountIds = [...input.source.deltas().keys(), ...input.target.deltas().keys()];
      const lockResult = await lockAccounts(tx, input.orgId, allAccountIds);
      if (!lockResult.ok) {
        throw new DomainRejection(lockResult.error);
      }

      const source = await applyLeg(tx, {
        orgId: input.orgId,
        actorId: input.actorId,
        transaction: input.source,
      });

      const target = await applyLeg(tx, {
        orgId: input.orgId,
        actorId: input.actorId,
        transaction: input.target,
        fxSourceTransactionId: source.transactionId,
        fxRate: input.rate,
      });

      // The key points at the **source** leg: it is the transaction the caller
      // asked for, and the target is reachable from it through the FX link. A
      // replay therefore reloads from the source and walks forward.
      await tx
        .update(ledgerIdempotencyKey)
        .set({ transactionId: source.transactionId })
        .where(eq(ledgerIdempotencyKey.id, reservation.value.id));

      return { kind: "posted", posted: { source, target } } as const;
    });
  } catch (caught) {
    if (caught instanceof DomainRejection) {
      await writeRejectionAudit(db, { ...input, transaction: input.source }, caught.reason);
      return err(caught.reason);
    }
    throw caught;
  }

  if (outcome.kind === "conflict") {
    await auditBestEffort(db, {
      orgId: input.orgId,
      actorUserId: input.actorId,
      action: "post_exchange",
      reason: "idempotency_conflict",
      metadata: { kind: outcome.error.kind, keyLength: outcome.error.idempotencyKey.length },
    });
    return err(outcome.error);
  }

  if (outcome.kind === "replay") {
    return ok(await loadPostedExchange(db, input.orgId, outcome.transactionId));
  }

  return ok(outcome.posted);
}

/**
 * Reconstructs both legs of an exchange for an idempotency replay.
 *
 * Finds the target by the FX link rather than by any assumption about ids or
 * ordering. The partial UNIQUE index on `fx_source_transaction_id` is what makes
 * "the" target well defined — without it this would have to return a list and
 * every caller would have to decide what more than one means.
 */
async function loadPostedExchange(
  db: Db,
  orgId: string,
  sourceTransactionId: string,
): Promise<PostedExchange> {
  const [targetRow] = await db
    .select({ id: ledgerTransaction.id })
    .from(ledgerTransaction)
    .where(
      and(
        eq(ledgerTransaction.orgId, orgId),
        eq(ledgerTransaction.fxSourceTransactionId, sourceTransactionId),
      ),
    );

  if (targetRow === undefined) {
    throw new Error(
      `exchange replay found no target leg linked to source transaction "${sourceTransactionId}" in org "${orgId}"`,
    );
  }

  const [source, target] = await Promise.all([
    loadPostedTransaction(db, orgId, sourceTransactionId),
    loadPostedTransaction(db, orgId, targetRow.id),
  ]);

  return { source, target };
}

/** Human-readable, machine-stable reason code stored on the rejection audit row (`ledger.md`'s `insufficient_funds`, etc.). */
function rejectionReasonCode(reason: DomainRejectionReason): string {
  switch (reason.kind) {
    case "AccountNotFound":
      return "account_not_found";
    case "AccountInactive":
      return "account_inactive";
    case "CurrencyMismatch":
      return "currency_mismatch";
    case "InsufficientFunds":
      return "insufficient_funds";
    case "TransactionAlreadyReversed":
      return "already_reversed";
  }
}

/** JSON-safe rejection detail for the audit row's `metadata` column — `Money` carries a `bigint`, which cannot be `JSON.stringify`d directly. */
function serializeRejectionMetadata(reason: DomainRejectionReason): Record<string, unknown> {
  switch (reason.kind) {
    case "AccountNotFound":
    case "AccountInactive":
      return { kind: reason.kind, accountId: reason.accountId };
    case "CurrencyMismatch":
      return { kind: reason.kind, expected: reason.expected, actual: reason.actual };
    case "TransactionAlreadyReversed":
      return { kind: reason.kind, transactionId: reason.transactionId };
    case "InsufficientFunds":
      return {
        kind: reason.kind,
        accountId: reason.accountId,
        balance: reason.balance.format(),
        delta: reason.delta.format(),
        resulting: reason.resulting.format(),
      };
  }
}

/**
 * Records a rejected attempt in its own, separate transaction — see the
 * "Rejection handling" note on `postTransaction` above for why this
 * cannot run inside the transaction that just rolled back.
 */
/**
 * Records a rejection discovered inside the locked section, after the failing
 * transaction has already rolled back.
 *
 * Delegates to `repositories/audit.ts`'s `recordRejection` rather than
 * inserting directly, so this package has exactly one implementation of "write
 * a rejection audit row". Phase 4b added the other two callers — the
 * pre-persistence validation failures in `packages/api`, which never reach
 * this function at all, and the idempotency conflict below.
 */
/**
 * Writes a rejection audit row **best-effort**.
 *
 * The caller is, in every case, already returning a correct and specific 4xx
 * for the real problem. Letting a failure of the *recording* escape would
 * replace that with a 500 — destroying the accurate error and writing no audit
 * row either, so the rejection is lost twice. Worse, 500 is the canonical
 * "unknown outcome, retry me" signal, so an auto-retrying client would loop on
 * a conflict it can never be told about.
 *
 * This mirrors the policy `packages/api`'s `recordDomainRejection` already
 * applies to the pre-persistence rejections it records. The failure is logged
 * so the gap is visible rather than silent.
 */
async function auditBestEffort(
  db: Db,
  entry: Parameters<typeof recordRejection>[1],
): Promise<void> {
  try {
    await recordRejection(db, entry);
  } catch (auditError) {
    console.error(
      { event: "rejection_audit.failed", action: entry.action, reason: entry.reason },
      auditError,
    );
  }
}

async function writeRejectionAudit(
  db: Db,
  input: PostTransactionInput,
  reason: DomainRejectionReason,
): Promise<void> {
  await auditBestEffort(db, {
    orgId: input.orgId,
    actorUserId: input.actorId,
    action: "post_transaction",
    reason: rejectionReasonCode(reason),
    metadata: serializeRejectionMetadata(reason),
  });
}

/** Reconstructs the original `PostedTransaction` for an idempotency replay — the caller gets back the same result as the original successful call, never a second posting. */
async function loadPostedTransaction(
  db: Db,
  orgId: string,
  transactionId: string,
): Promise<PostedTransaction> {
  const [transactionRow] = await db
    .select()
    .from(ledgerTransaction)
    .where(and(eq(ledgerTransaction.id, transactionId), eq(ledgerTransaction.orgId, orgId)));

  if (transactionRow === undefined) {
    throw new Error(
      `idempotency replay pointed at missing ledger_transaction "${transactionId}" for org "${orgId}"`,
    );
  }

  const postingRows = await db
    .select()
    .from(ledgerPosting)
    .where(and(eq(ledgerPosting.transactionId, transactionId), eq(ledgerPosting.orgId, orgId)));

  const accountIds = [...new Set(postingRows.map((row) => row.accountId))];
  const accountRows =
    accountIds.length === 0
      ? []
      : await db
          .select()
          .from(ledgerAccount)
          .where(and(eq(ledgerAccount.orgId, orgId), inArray(ledgerAccount.id, accountIds)));

  const balances = new Map<string, Money>();
  for (const row of accountRows) {
    balances.set(row.id, toMoney(row.balance, row.currency, `ledger_account "${row.id}"`));
  }

  return {
    transactionId: transactionRow.id,
    orgId: transactionRow.orgId,
    currency: toCurrency(transactionRow.currency, `ledger_transaction "${transactionId}"`),
    createdAt: transactionRow.createdAt,
    reversesTransactionId: transactionRow.reversesTransactionId,
    postings: postingRows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      direction: row.direction,
      amount: toMoney(row.amount, row.currency, `ledger_posting "${row.id}"`),
    })),
    balances,
    replayed: true,
  };
}
