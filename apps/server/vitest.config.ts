import { defineConfig } from "vitest/config";

/**
 * The `apps/server` suite — the first tests this app has ever had (2026-08-16).
 *
 * Until now the composition in `src/index.ts` was untestable by construction:
 * it called `serve()` at module scope, so importing anything from it started a
 * real listener. `src/app.ts` exists to separate the app from the process, and
 * this config is what makes that separation worth something.
 *
 * ## Why there is no Testcontainers setup here
 *
 * Unlike `packages/db` and `packages/api`, nothing in this suite needs a
 * *working* database. It covers the HTTP composition — response headers, body
 * limits, probe routing, log redaction — and the one database-dependent case is
 * `/ready` proving it reports **unavailable** when Postgres is gone. That case
 * wants a connection that fails, which is free; standing up a real container to
 * then make it unreachable would be slower and prove less.
 *
 * So `DATABASE_URL` below points at a port nothing listens on, deliberately.
 * `pg.Pool` connects lazily, so importing the app is fine; only `/ready`'s
 * `SELECT 1` actually reaches for the socket and is refused, which is exactly
 * the state being asserted.
 *
 * `SKIP_ENV_VALIDATION` is **not** set, unlike the other suites: these values
 * are real and satisfy the Zod schema, so `packages/env`'s validation stays
 * exercised rather than bypassed — the same reasoning `.github/workflows/ci.yml`
 * gives for setting explicit throwaway values instead of the skip flag.
 */
export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Port 1 is privileged and unbound: connections are refused immediately
      // rather than hanging until a timeout, which keeps the `/ready` failure
      // case fast and deterministic.
      DATABASE_URL: "postgresql://postgres:password@127.0.0.1:1/unreachable",
      BETTER_AUTH_SECRET: "test-not-a-secret-value-at-least-32-chars-long",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:3001",
      NODE_ENV: "test",
    },
  },
});
