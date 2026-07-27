import { defineConfig } from "vitest/config";

/**
 * The API boundary suite. Two kinds of test live here and the config has to
 * serve both:
 *
 * - **Pure units** (`auth/roles`, `errors`, `contracts/*`) — no database, no
 *   HTTP. They are the majority of files and run in milliseconds.
 * - **Integration** (`routers/*.test.ts`) — a real Postgres via
 *   Testcontainers, because invariant #5 (no cross-tenant leakage) is only
 *   meaningfully proven through the real repositories against real
 *   `org_id`-filtered SQL. Mocking the db layer here would prove nothing.
 *
 * `env` closes the same trap `packages/db/vitest.config.ts` documents:
 * `@fintech-ledger-sandbox/db`'s `src/index.ts` imports
 * `@fintech-ledger-sandbox/env/server` at module scope, and that module
 * validates `DATABASE_URL` via Zod at *import* time. There is no root `.env`
 * to satisfy it (only `apps/server/.env`, which a package must not depend
 * on — see `coding-rules.md`), so any test file that transitively imports
 * `packages/db` would throw before running. `SKIP_ENV_VALIDATION` makes
 * `createEnv` return `process.env` unvalidated instead. No `DATABASE_URL`
 * fallback is needed: every test builds its `Db` from the
 * Testcontainers-allocated connection string via `createDb(...)`, never the
 * unvalidated env var.
 *
 * `globalSetup` starts ONE shared Postgres for the whole run (see
 * `src/test/global-setup.ts`), reusing `packages/db`'s published harness
 * rather than standing up a second one. `fileParallelism: false` is required
 * alongside it for the same reason it is in `packages/db`: every integration
 * file shares that container's rows through `.reset()`, so two files running
 * concurrently in separate workers would truncate tables out from under each
 * other. The cost is that the fast unit files are serialized behind the slow
 * integration ones — acceptable while this suite is small, and the
 * alternative (a second Vitest project) buys little for the complexity.
 */
export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
    globalSetup: ["./src/test/global-setup.ts"],
    fileParallelism: false,
    // Testcontainers cold-starts (pulling + starting Postgres, then running
    // migrations) comfortably exceed Vitest's 10s default hook timeout on a
    // first pull. The container starts once for the whole run, not per file.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
