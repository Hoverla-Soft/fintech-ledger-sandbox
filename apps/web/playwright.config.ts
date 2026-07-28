import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite (Phase 6c).
 *
 * Replaces the numbered **manual** demo scripts every Phase 5 slice carried as
 * acceptance criteria — roughly 40 steps across six slices, re-run by hand.
 *
 * ## Why this starts two servers
 *
 * The console is a separate origin from the API (3001 and 3000), and the whole
 * point of an e2e test here is that the real oRPC call crosses that boundary
 * with a real session cookie and a real CORS policy. Mocking either would test
 * the console against a fiction.
 *
 * ## Why there is no database reset
 *
 * Every spec file creates its own uniquely-named user and organization, so
 * isolation comes from tenancy rather than from truncation. That is the same
 * property the API's own integration suites rely on, it keeps files
 * order-independent and parallelisable, and it means running the suite twice
 * against the same database is safe. A shared truncate would make every spec
 * order-dependent and could not run in parallel.
 *
 * Postgres itself is expected to be up (`pnpm db:start`) and migrated — it is
 * not started here, because a browser suite silently bringing up and migrating
 * a database is a surprising amount of hidden state for a test run to own.
 */
export default defineConfig({
  testDir: "./e2e",

  // `src/**` belongs to Vitest (see vitest.config.ts). These two globs cannot
  // overlap: Vitest's `include` is `src/**/*.test.{ts,tsx}` and this testDir is
  // a sibling of `src`, so neither runner can collect the other's files.
  testMatch: /.*\.e2e\.ts/,

  // A ledger's flows are inherently sequential (create account → transfer →
  // reverse) and each spec walks a full sign-up. Running files in parallel
  // against one Postgres is safe by D3, but the local default is conservative
  // because open question #19 already records timing sensitivity in this app's
  // test suites.
  fullyParallel: false,
  workers: 1,

  // Never allow `.only` to reach CI — it silently reduces the suite to one
  // spec while still reporting green.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:3001",
    // Kept only for a failing test: a trace per run would be gigabytes and
    // nobody reads the passing ones.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "pnpm --filter server dev",
      url: "http://localhost:3000",
      // Locally, reuse whatever `pnpm dev` already has running. In CI there is
      // never a server to reuse, and reusing one would hide a broken start.
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter web dev",
      url: "http://localhost:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
