import { sql } from "drizzle-orm";

import type { Db } from "./index";

/**
 * The unprivileged role every org-scoped statement runs as.
 *
 * Created by `drizzle/0008_row_level_tenancy.sql`, which also attaches the
 * row-level security policies that only bite for a non-owner. Nothing outside
 * this module should need the name.
 */
const LEDGER_APP_ROLE = "ledger_app";

/**
 * Runs `work` with the database pinned to one organization.
 *
 * Inside the callback the session is `ledger_app`, a role that owns nothing and
 * is therefore subject to the row-level policies from migration 0008. Every
 * org-scoped table is filtered to `app.current_org_id`, so a query that forgets
 * its `org_id` predicate returns no rows rather than every tenant's — the
 * database half of invariant #5, complementing ADR 0005's API half.
 *
 * Both settings use `set_config(..., is_local => true)`, which scopes them to
 * this transaction. They revert on COMMIT, so a pooled connection is never
 * handed to the next request still switched into the restricted role. `role` is
 * assigned through `set_config` rather than `SET LOCAL ROLE` only because
 * `set_config` takes a bind parameter, keeping the org id out of SQL text.
 *
 * ## Why this always commits
 *
 * Load-bearing, and the reason this is not a plain `db.transaction(...)`.
 *
 * `postTransaction` deliberately writes its rejection audit *after* its own
 * transaction has rolled back — an audit row written inside the failing
 * transaction would roll back with it, leaving `ledger.md` line 54's "every
 * rejection is recorded" unmet. It then returns an error `Result`, and the API
 * handler turns that into a thrown `ORPCError`. If that throw reached Drizzle's
 * transaction wrapper it would roll the whole request back, discarding exactly
 * the audit row that was written to survive a rollback.
 *
 * So a throw is captured, the transaction is allowed to commit, and the error is
 * rethrown afterwards. That leaves atomicity entirely where it already was —
 * each `postTransaction` owns its own nested transaction, which drizzle-orm
 * implements as a SAVEPOINT and which still rolls back on its own — and makes
 * this wrapper purely a scoping device that changes no write's durability.
 *
 * `work` may return a bare value or a thenable, not just a `Promise`: oRPC's
 * `next` is typed `T | PromiseLike<T>`, and narrowing this to `Promise<T>`
 * would leave `T` unresolved at that call site — which silently drops `orgId`,
 * `actorId`, and `role` out of every downstream handler's context type.
 */
export async function withOrgScope<T>(
  db: Db,
  orgId: string,
  work: (scoped: Db) => T | PromiseLike<T>,
): Promise<T> {
  let failure: { readonly error: unknown } | undefined;

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    await tx.execute(sql`SELECT set_config('role', ${LEDGER_APP_ROLE}, true)`);

    try {
      // The callback is handed the transaction as a `Db`. A `PgTransaction`
      // exposes the same query-builder surface (`select`/`insert`/`update`/
      // `execute`/`transaction`) and differs only in `$client`, the pool handle,
      // which is touched exclusively at process lifecycle points — `/ready` and
      // shutdown in `apps/server` — never inside a request. Asserting that here
      // keeps the ~30 repository signatures on `Db` instead of widening every
      // one of them to a union to express a distinction no caller uses.
      return await work(tx as unknown as Db);
    } catch (error) {
      failure = { error };
      return undefined;
    }
  });

  if (failure !== undefined) {
    throw failure.error;
  }

  return outcome as T;
}
