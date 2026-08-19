import { env } from "@fintech-ledger-sandbox/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

/**
 * Builds a fresh Drizzle client. Accepts an optional connection string so
 * a caller whose connection isn't `env.DATABASE_URL` — most importantly
 * Testcontainers-backed tests, whose Postgres URL is allocated dynamically
 * after the container starts — can build a client bound to that URL
 * instead of the process-wide env var. Defaults to `env.DATABASE_URL` for
 * normal app usage (`packages/auth`, `apps/server`).
 *
 * There is deliberately no module-level `db` singleton alongside this: a
 * lazy `Proxy` was tried and rejected. It only traps `get`, so
 * `instanceof`, `Object.keys`, spread, and `set` would all silently
 * resolve against an empty placeholder object, and any method extracted
 * off it (`const { transaction } = db`) would run unbound — `this` would
 * be the Proxy, not the real client. That "worked" only by accident of
 * drizzle-orm 0.45.2 storing its API as plain instance properties; a
 * version that used getters or `#private` fields would break it silently.
 * Approved boundary decision 3 (see
 * `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`) already routes
 * every caller — `postTransaction`, every repository, `packages/auth`,
 * tests — through an explicitly injected `createDb()` instance, so the
 * singleton has no consumer to preserve.
 */
/**
 * How long Postgres will let a single statement run before aborting it.
 *
 * Server-side (`statement_timeout`), deliberately, not node-postgres'
 * client-side `query_timeout`: the client-side one only makes the driver stop
 * waiting, while the server keeps executing the statement and keeps holding
 * whatever locks it took. That is the opposite of what a timeout is for here.
 *
 * Ten seconds and not one. `reserve-key.ts` uses a plain blocking `INSERT` on
 * purpose so that the loser of an idempotency race waits for the winner to
 * commit — a bound tight enough to fire during that wait would turn a correct
 * serialization into a spurious error. A bound is still right at this length
 * because `postTransaction` runs inside a single transaction, so an abort
 * rolls the whole thing back rather than partially, and every caller holds an
 * idempotency key that makes the retry safe: an abort costs a retry, not a
 * correctness violation. Re-check this argument before any code blocks on a
 * lock *outside* a transaction.
 */
const STATEMENT_TIMEOUT_MS = 10_000;

/**
 * How long a session may sit idle *inside* an open transaction before Postgres
 * kills it, releasing its locks.
 *
 * Longer than `STATEMENT_TIMEOUT_MS` on purpose. This one catches an
 * *abandoned* transaction — a client that opened one and went away — whereas
 * `statement_timeout` catches a slow one. A legitimate transaction runs several
 * statements, so setting this at or below the statement bound would kill
 * transactions that are merely working.
 */
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * How long to wait for a new connection before giving up.
 *
 * Without it, connecting to a Postgres that is gone hangs indefinitely, and
 * `apps/server`'s `/ready` probe queries the database — so a hang there
 * produces a probe that never answers rather than one that reports unhealthy.
 * That is the same wrong failure direction as the liveness bug already fixed in
 * `apps/server`: a supervisor can act on "unhealthy", not on "still waiting".
 */
const CONNECTION_TIMEOUT_MS = 5_000;

export function createDb(connectionString: string = env.DATABASE_URL) {
  return drizzle({
    connection: {
      connectionString,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    },
    schema,
  });
}

/**
 * The type of an injected Drizzle instance, as built by `createDb`. Every
 * write routine and read repository in this package (Approved boundary
 * decision 3) takes one of these as a parameter rather than reaching for a
 * module-level singleton, so this is the shared type both this package's
 * internals and external consumers (`packages/auth` today, `packages/api`
 * from Phase 4) type their dependency against.
 */
export type Db = ReturnType<typeof createDb>;

export { withOrgScope } from "./tenancy";
