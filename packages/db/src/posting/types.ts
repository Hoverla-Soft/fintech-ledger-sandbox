import type { Db } from "../index";

/**
 * The transaction-scoped Drizzle client passed into a `db.transaction(...)`
 * callback. Structurally the same query-builder surface as `Db`, but kept
 * as its own type (derived from `Db["transaction"]`'s own callback
 * parameter rather than importing drizzle-orm's internal transaction
 * class by name) so the locking/reservation helpers below can only be
 * called from inside an already-open Postgres transaction, never against
 * the top-level connection.
 */
export type PostingTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
