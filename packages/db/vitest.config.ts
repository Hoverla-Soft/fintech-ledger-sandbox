import { defineConfig } from "vitest/config";

/**
 * The persistence integration suite. Unlike `packages/core`'s pure unit
 * suite, this one requires a real Postgres via Testcontainers (a Docker
 * daemon must be reachable) — see `src/test/setup.ts`. Tests still sit
 * next to the code they cover (`src/**\/*.test.ts`), same convention as
 * every other package.
 *
 * `env` closes a real trap: `src/index.ts` imports
 * `@fintech-ledger-sandbox/env/server` at module scope, and that module
 * validates `DATABASE_URL` (via Zod, at *import* time) with no root
 * `.env` to satisfy it — only `apps/server/.env` exists, and
 * `packages/db` must not depend on an app's env file (`coding-rules.md`).
 * `packages/env/src/server.ts` already supports
 * `skipValidation: !!process.env.SKIP_ENV_VALIDATION`, so setting it here
 * makes `createEnv` return `process.env` unvalidated instead of throwing.
 * Vitest applies `test.env` to the actual OS-level environment of the
 * worker process it spawns for this project (see
 * `setupFiles`/pool-worker construction in vitest's own `cli-api` chunk),
 * so this is in place before a single test file — and therefore before
 * `@fintech-ledger-sandbox/db` itself — is ever imported. No `DATABASE_URL`
 * fallback is needed: every test builds its own `Db` from the
 * Testcontainers-allocated connection string via `createDb(...)`
 * (approved boundary decision 3), never the unvalidated env var.
 *
 * `globalSetup` starts one shared Postgres container for the acceptance
 * suite (`src/test/global-setup.ts`), handed to test files via
 * `inject("dbTestConnectionString")` instead of a fresh Testcontainers cold
 * start per file. `fileParallelism: false` is required alongside it: every
 * file in this project shares that one container's rows through
 * `.reset()`, so two files running concurrently in separate workers would
 * otherwise truncate tables out from under each other. The pre-existing
 * smoke test (`posting/post-transaction.test.ts`) still owns its own
 * isolated container via `startTestDatabase()`, unaffected by this.
 */
export default defineConfig({
  test: {
    name: "db",
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
    globalSetup: ["./src/test/global-setup.ts"],
    fileParallelism: false,
    // Testcontainers cold-starts (pulling + starting Postgres, then
    // running migrations) can comfortably exceed Vitest's 10s default
    // hook timeout, especially on a first pull. Generous on purpose;
    // the container starts once per file in a `beforeAll` (or once for the
    // whole run via `globalSetup`), not per test.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
