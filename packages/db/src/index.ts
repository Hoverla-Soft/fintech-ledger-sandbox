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
export function createDb(connectionString: string = env.DATABASE_URL) {
  return drizzle(connectionString, { schema });
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
