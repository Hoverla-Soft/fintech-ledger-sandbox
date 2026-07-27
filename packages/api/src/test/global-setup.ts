import type { TestDatabase } from "@fintech-ledger-sandbox/db/testing";
import type { TestProject } from "vitest/node";

/**
 * Vitest `globalSetup` for the API suite: starts exactly ONE Postgres
 * container for the whole `vitest run`, migrates it, and hands its
 * connection string to test files via `inject("dbTestConnectionString")`.
 *
 * The container and every detail of standing it up — image version,
 * migrations folder, the truncate list, the immutability-trigger workaround —
 * come from `@fintech-ledger-sandbox/db/testing`, the harness `packages/db`
 * publishes for exactly this (approved boundary decision 4). Duplicating any
 * of that here would fork it from the schema it has to track.
 *
 * Paired with `fileParallelism: false` in `vitest.config.ts`: every file
 * shares this one container's rows through `.reset()`, so concurrent files in
 * separate workers would truncate tables out from under each other.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // The import below is deliberately **dynamic**, and the env flag is
  // deliberately set before it — same trap `packages/db/src/test/global-setup.ts`
  // documents. `@fintech-ledger-sandbox/db/testing` transitively imports
  // `packages/db`'s `src/index.ts`, which validates `DATABASE_URL` via Zod at
  // *module scope*. This file runs in Vitest's own process, which
  // `vitest.config.ts`'s `test.env` is only guaranteed to reach for worker
  // processes — and there is no root `.env` to satisfy the validation. A
  // static `import` would have executed that module before this line ever
  // ran, throwing before a container could start.
  process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION ?? "1";
  const { startTestDatabase } = await import("@fintech-ledger-sandbox/db/testing");

  const database: TestDatabase = await startTestDatabase();

  project.provide("dbTestConnectionString", database.connectionString);

  return async () => {
    await database.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    dbTestConnectionString: string;
  }
}
