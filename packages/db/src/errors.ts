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

export type PersistenceError = AccountNotFound | TransactionNotFound | IdempotencyConflict;

export function isPersistenceError(candidate: unknown, kind: PersistenceError["kind"]): candidate is PersistenceError {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "kind" in candidate &&
    (candidate as { kind: unknown }).kind === kind
  );
}
