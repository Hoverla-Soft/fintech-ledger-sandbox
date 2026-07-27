import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { TestProject } from "vitest/node";

/**
 * Vitest `globalSetup` for `packages/db`'s acceptance suite
 * (`docs/product/requirements/ledger.md` invariants #2–#8): starts exactly
 * ONE Postgres container for the whole `vitest run` invocation instead of
 * one per test file. Testcontainers cold starts cost real seconds, and the
 * acceptance suite spans several files organized by invariant/concern
 * (`docs/test-coverage.md`), so per-file containers would multiply that
 * cost for no isolation benefit within a single, disposable test database.
 *
 * Paired with `fileParallelism: false` in `vitest.config.ts`: every file in
 * this project runs strictly one at a time, so two files can never run
 * concurrently and clobber each other's `.reset()` truncation against this
 * one shared container.
 *
 * The pre-existing smoke test (`posting/post-transaction.test.ts`) keeps
 * its own `startTestDatabase()` container, unchanged. This global container
 * is additive — only the newer acceptance-suite files opt in, via
 * `connectTestDatabase(inject("dbTestConnectionString"))` from
 * `test/setup.ts`.
 *
 * Runs in Vitest's own process, not the worker `packages/db/vitest.config.ts`
 * sets `env: { SKIP_ENV_VALIDATION: "1" }` for — that `test.env` value is
 * only guaranteed to reach the worker process that executes test files, not
 * necessarily this globalSetup script. `createDb`'s default parameter reads
 * `@fintech-ledger-sandbox/env/server`'s `env.DATABASE_URL` at import time,
 * which throws with no `SKIP_ENV_VALIDATION` set and no root `.env` to
 * satisfy it — so this file never imports `../index` at module scope.
 * Setting the env var before a *dynamic* `import()` (deferred to runtime,
 * unlike a static `import`, which would already have run `../index`'s
 * module-scope code before this line executes) sidesteps that import-time
 * validation regardless of what this process already has set.
 */
const POSTGRES_IMAGE = "postgres:18";

const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION ?? "1";
  const { createDb } = await import("../index");

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("fintech_ledger_acceptance")
    .withUsername("postgres")
    .withPassword("password")
    .start();

  const connectionString = container.getConnectionUri();
  const db = createDb(connectionString);

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  project.provide("dbTestConnectionString", connectionString);

  return async () => {
    await db.$client.end();
    await container.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    dbTestConnectionString: string;
  }
}
