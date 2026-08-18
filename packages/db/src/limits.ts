/**
 * Storage limits of the ledger's columns.
 *
 * **This module must never import anything.** It is reachable from the browser
 * bundle — `apps/web` → `packages/api/contracts/money` → here — and that path
 * is only safe while this file is a leaf. Importing so much as a type from a
 * sibling would drag that sibling's module graph across the boundary with it.
 *
 * The file exists because the previous arrangement did exactly that. When
 * `MAX_MINOR_UNITS` was moved into `posting/post-transaction.ts` (open question
 * #27, to give it a single definition), `contracts/money.ts` re-exported it
 * from `@fintech-ledger-sandbox/db/posting` — which pulled `post-transaction`,
 * `reserve-key`, `repositories/audit`, drizzle and the Postgres driver into the
 * console's bundle. `/transfer` then died in a real browser on
 * `Module "node:crypto" has been externalized for browser compatibility`.
 *
 * Neither `pnpm build` nor `pnpm check-types` failed on it: Vite *warns* and
 * carries on, and `apps/web`'s component suite runs in happy-dom under Node,
 * where `node:crypto` resolves perfectly well. It took an actual browser to
 * find it — see `apps/web/e2e/transfer.e2e.ts`.
 */

/**
 * The largest magnitude a minor-unit value can take and still be storable.
 *
 * `ledger_account.balance` and `ledger_posting.amount` are Postgres `bigint`
 * (int8), whose range is ±(2^63 − 1). `Money` is backed by a JavaScript
 * `bigint` and is happily unbounded, so nothing in the domain protects these
 * columns; this is the number that does.
 *
 * One definition, deliberately. `packages/api` bounds an inbound *amount*
 * against it and `posting/post-transaction.ts` bounds the *accumulated balance*
 * against it, and two literals of 2^63 − 1 that drifted would mean the request
 * check and the balance check disagreeing about what is storable.
 *
 * Applied to magnitude, so `−2^63` is refused even though int8 can hold it.
 * Off by one on purpose: one rule beats two that differ by one in a direction
 * nobody will remember.
 */
export const MAX_MINOR_UNITS = 9_223_372_036_854_775_807n;
