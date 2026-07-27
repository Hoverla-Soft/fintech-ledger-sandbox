import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb, type Db } from "../index";

/**
 * Testcontainers bootstrap for `packages/db`'s integration suite.
 *
 * Internal to this package on purpose — not part of the `"./*"` export
 * map narrowed in Phase 3 (approved boundary decision 1). A caller
 * outside this package has no legitimate reason to spin up a test
 * database; only this package's own `*.test.ts` files import it, via a
 * relative path.
 *
 * Not auto-wired as a global Vitest `setupFiles` hook: starting a
 * container is slow (seconds, not milliseconds), so each test file calls
 * `startTestDatabase()` itself, once, in a `beforeAll` — never per test —
 * and `stop()`s it in `afterAll`. Use `.reset()` in a `beforeEach` to wipe
 * state between tests without paying the container-startup cost again.
 */

/** Same major version as `packages/db/docker-compose.yml`'s local dev database, so behaviour matches what `pnpm db:start` runs against. */
const POSTGRES_IMAGE = "postgres:18";

const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** Tables truncated between tests. Every table Better Auth's core + organization plugin and the ledger schema define. */
const ALL_TABLES = [
  "ledger_audit_entry",
  "ledger_idempotency_key",
  "ledger_posting",
  "ledger_transaction",
  "ledger_account",
  "invitation",
  "member",
  "organization",
  "verification",
  "session",
  "account",
  "user",
] as const;

export interface TestDatabase {
  readonly db: Db;
  readonly connectionString: string;
  /** Wipes every table's rows (not the schema) so the next test starts from a clean slate. Safe to call between every test in a file sharing one container. */
  reset(): Promise<void>;
  /** Stops the container. Call once, in `afterAll`. */
  stop(): Promise<void>;
}

/**
 * Starts a fresh Postgres container, applies every migration in
 * `packages/db/drizzle/` against it via `drizzle-kit`'s own migrator (the
 * same migration workflow `docs/development/tech-stack.md` declares —
 * never a second, ad hoc one), and returns a ready-to-use `Db` bound to
 * that container.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("fintech_ledger_test")
    .withUsername("postgres")
    .withPassword("password")
    .start();

  const connectionString = container.getConnectionUri();
  const db = createDb(connectionString);

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    connectionString,
    reset: () => resetTestDatabase(db),
    stop: async () => {
      // Close the pg pool before tearing down the container so no test
      // process is left holding an open connection to a container that's
      // about to disappear.
      await db.$client.end();
      await container.stop();
    },
  };
}

/**
 * Binds to an already-running Postgres instance instead of starting a new
 * container — used by the acceptance suite (`*.test.ts` files covering
 * `docs/product/requirements/ledger.md`'s invariants #2–#8), which shares
 * ONE container across the whole `packages/db` vitest run via
 * `test/global-setup.ts` + `inject("dbTestConnectionString")` rather than
 * paying a fresh Testcontainers cold start per file. `startTestDatabase`
 * above stays the right choice for a file that must own its container's
 * full lifecycle in isolation (this package's original smoke test).
 */
export function connectTestDatabase(connectionString: string): Pick<TestDatabase, "db" | "connectionString" | "reset"> {
  const db = createDb(connectionString);
  return {
    db,
    connectionString,
    reset: () => resetTestDatabase(db),
  };
}

/**
 * Truncates every table. `ledger_posting`'s immutability trigger
 * (invariant #8, `drizzle/0002_ledger_posting_immutability_trigger.sql`)
 * blocks `DELETE` *and* `TRUNCATE` on that table by design, so it is
 * disabled for the duration of this one statement and re-enabled
 * immediately after — a test-harness-only exception to invariant #8,
 * never something application code does.
 */
async function resetTestDatabase(db: Db): Promise<void> {
  await db.execute(sql`ALTER TABLE ledger_posting DISABLE TRIGGER ledger_posting_immutability_trigger`);
  await db.execute(sql`ALTER TABLE ledger_posting DISABLE TRIGGER ledger_posting_immutability_truncate_trigger`);
  try {
    await db.execute(sql`TRUNCATE TABLE ${sql.raw(ALL_TABLES.map((table) => `"${table}"`).join(", "))} RESTART IDENTITY CASCADE`);
  } finally {
    await db.execute(sql`ALTER TABLE ledger_posting ENABLE TRIGGER ledger_posting_immutability_trigger`);
    await db.execute(sql`ALTER TABLE ledger_posting ENABLE TRIGGER ledger_posting_immutability_truncate_trigger`);
  }
}
