/**
 * The public posting surface. Exports only `postTransaction` (approved
 * boundary decision 1 in
 * `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`) — the internal
 * lock-ordering and idempotency-reservation helpers it composes
 * (`lock-accounts.ts`, `reserve-key.ts`) are never re-exported, so no
 * caller outside this package can invoke a locking step out of order.
 * The types below describe `postTransaction`'s own public contract
 * (its input/output/error shapes), not the internals, so they travel with
 * it.
 */

export type {
  PostExchangeInput,
  PostedExchange,
  PostedPosting,
  PostedTransaction,
  PostTransactionError,
  PostTransactionInput,
} from "./post-transaction";
export { postExchange, postTransaction } from "./post-transaction";
