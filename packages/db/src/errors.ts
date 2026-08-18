import type { Money } from "@fintech-ledger-sandbox/core";

/**
 * Persistence-layer errors for `packages/db`.
 *
 * Deliberately does not redeclare any member of `packages/core`'s
 * `LedgerError` union (approved boundary decision 2 in
 * `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`) —
 * `InsufficientFunds`/`CurrencyMismatch`/etc. already exist there and are
 * what `core.applyDelta` returns. `postTransaction`'s result type unions
 * these with core's re-exported `LedgerError` instead of restating it.
 * Same discriminated-union (`kind` field) + `Result`/`ok`/`err` style as
 * `packages/core`.
 */

/**
 * An account id was not found for the calling org — either the id
 * genuinely doesn't exist, or it belongs to another organization. The two
 * cases are deliberately indistinguishable: `ledger.md` line 56 requires
 * that a cross-org id never reveal that the row exists elsewhere, so every
 * lookup filters by `org_id` first and reports this same error either way.
 */
export interface AccountNotFound {
  readonly kind: "AccountNotFound";
  readonly accountId: string;
}

/**
 * A transaction id was not found for the calling org. Same
 * indistinguishable-missing-vs-cross-org design as `AccountNotFound`.
 */
export interface TransactionNotFound {
  readonly kind: "TransactionNotFound";
  readonly transactionId: string;
}

/**
 * The idempotency key was already reserved with a different
 * `requestHash` — a client retried the same key with a different payload
 * (`ledger.md` line 57). Same key + same hash is a *replay*, not this
 * error — see `posting/reserve-key.ts`.
 */
export interface IdempotencyConflict {
  readonly kind: "IdempotencyConflict";
  readonly idempotencyKey: string;
}

/**
 * An account exists for this org under the requested name. `(org_id, name)`
 * is unique in the schema, and `createAccount` previously let that constraint
 * surface as a raw `DrizzleQueryError` — an unhandled 500 at the API boundary.
 * Typed here rather than sniffed for SQLSTATE `23505` in `packages/api`,
 * because the `cause`-chain unwrap that requires is module-private to
 * `posting/reserve-key.ts` and is already recorded in ADR 0004 as fragile
 * against a drizzle-orm upgrade; duplicating it would double that blast
 * radius across two packages.
 */
export interface AccountAlreadyExists {
  readonly kind: "AccountAlreadyExists";
  readonly name: string;
}

/**
 * A posting targeted a deactivated account (`ledger.md` line 56).
 *
 * Deliberately *not* collapsed into `AccountNotFound`. The
 * indistinguishability rule above exists to stop a caller learning that a row
 * exists in **another tenant**; within the caller's own org there is nothing
 * to hide, and the read surface already exposes `active` on every account —
 * so reporting a 404 here would contradict what `accounts.list` just told the
 * same caller. Detected inside `lockAccounts`, under the row lock, because a
 * check in the caller would be racy against a concurrent deactivation.
 */
export interface AccountInactive {
  readonly kind: "AccountInactive";
  readonly accountId: string;
}

/**
 * A second reversal of a transaction that has already been reversed.
 *
 * Enforced by the partial unique index on `reverses_transaction_id` (migration
 * `0007`) rather than by a read-then-write check, which two concurrent
 * reversals could both pass. ADR 0006's consequences named this as the fix:
 * without it, both reversals succeed whenever balances allow and *double the
 * correction*, leaving the ledger further from the truth than before anyone
 * tried to fix it.
 *
 * Distinct from a reversal **chain** — reversing a reversal targets a different
 * transaction id and stays permitted.
 */
export interface TransactionAlreadyReversed {
  readonly kind: "TransactionAlreadyReversed";
  readonly transactionId: string;
}

/**
 * A posting would leave an account holding more than `ledger_account.balance`
 * can store.
 *
 * The gap this closes (`docs/open-questions.md` #27) is that **a per-amount
 * bound is not a per-balance bound**. `packages/api`'s `parseBoundedAmount`
 * already refuses a single posting outside int8's range, but two amounts that
 * are each storable can accumulate into one that is not. Verified rather than
 * assumed: two transfers, one at int8's ceiling and one of `0.01`, produced
 * `22003 value "9223372036854775808" is out of range for type bigint` from the
 * balance `UPDATE` — a raw driver error, so a 500, and the audit log recorded
 * nothing at all.
 *
 * Typed here rather than sniffed for SQLSTATE `22003` at the API boundary, for
 * the reason `AccountAlreadyExists` gives: the `cause`-chain unwrap that
 * requires is module-private to `posting/reserve-key.ts` and already recorded
 * in ADR 0004 as fragile against a drizzle-orm upgrade. And detecting it
 * *before* the write, under the row lock the balance update already holds,
 * means the refusal is an ordinary `DomainRejection` — which rolls the
 * transaction back and writes a rejection audit row, like every other refusal
 * in this ledger.
 */
export interface BalanceLimitExceeded {
  readonly kind: "BalanceLimitExceeded";
  readonly accountId: string;
  readonly balance: Money;
  readonly delta: Money;
  readonly resulting: Money;
}

/**
 * An account was asked to be closed while it still holds a balance.
 *
 * Closing a funded account would strand the money: postings to it are refused
 * once `active` is false, but the balance keeps counting toward every whole-org
 * total and toward reconciliation. The account would be simultaneously
 * unusable and still on the books, which is the worst of both — so the balance
 * has to be moved out first.
 *
 * Detected by the `AND balance = 0` predicate on the conditional `UPDATE` in
 * `repositories/accounts.ts`, not by a read-then-write: a check followed by a
 * separate update lets a posting land between the two and close an account that
 * was funded a millisecond ago.
 */
export interface AccountNotEmpty {
  readonly kind: "AccountNotEmpty";
  readonly accountId: string;
}

export type PersistenceError =
  | TransactionAlreadyReversed
  | AccountNotFound
  | AccountInactive
  | AccountAlreadyExists
  | AccountNotEmpty
  | TransactionNotFound
  | BalanceLimitExceeded
  | IdempotencyConflict;

export function isPersistenceError(
  candidate: unknown,
  kind: PersistenceError["kind"],
): candidate is PersistenceError {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "kind" in candidate &&
    (candidate as { kind: unknown }).kind === kind
  );
}
