import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The console suite (added Phase 5a).
 *
 * `environment: "happy-dom"` rather than `node`, even though 5a itself ships
 * only pure modules. The behaviours this suite exists to protect are mostly
 * not pure — "the dialog closes only after the request resolves", "submit is
 * disabled in flight", "the form stays open with the reason inline"
 * (`docs/product/requirements/ledger.md:75-76`) — and standing the DOM up now
 * means 5b renders its first component into a harness that already works,
 * rather than debugging the harness and the component at the same time.
 * happy-dom over jsdom for start-up cost; nothing here needs jsdom's wider
 * API surface.
 *
 * Deliberately NOT a re-use of `vite.config.ts`. That config runs
 * `tanstackRouter()`, which **regenerates `src/routeTree.gen.ts` as a side
 * effect** — a test run must not rewrite a checked-in source file. The React
 * plugin is included because later slices test `.tsx`; `resolve.tsconfigPaths`
 * mirrors `vite.config.ts:10-12` so `@/` means the same thing in a test as it
 * does in the app.
 *
 * `SKIP_ENV_VALIDATION` closes the same import-time trap `packages/api` and
 * `packages/db` document: `@fintech-ledger-sandbox/env/web` validates
 * `VITE_SERVER_URL` via Zod when the module is *imported*
 * (`packages/env/src/web.ts:4-12`), and there is no `.env` in the test
 * environment. 5a's modules import no env, but 5b's will, and a suite that
 * only breaks once someone adds an import is worse than one configured
 * correctly from the start.
 *
 * No `globalSetup` and no `fileParallelism: false`: unlike the `packages/api`
 * and `packages/db` suites, nothing here shares a database, so files run in
 * parallel and need no Docker daemon.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: "web",
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // Open question #19: this suite times out under load, never on an
    // assertion. Measured in isolation the slowest test here is ~1.3s
    // (`features/transfer/transfer-form.test.tsx`); the recorded failure was
    // 5351ms against the 5000ms default, with `turbo run test` driving four
    // package suites at once on a shared runner.
    //
    // So the default is not measuring "is this test correct", it is measuring
    // "how contended was the machine" — and on CI that produces red builds
    // nobody can act on. 15s restores the headroom the isolated numbers say
    // this suite needs while still failing a genuine hang.
    //
    // Deliberately not `retry`: a retry would hide a real intermittent bug in a
    // ledger's own suite, which is the one place that must not be papered over.
    testTimeout: 15_000,
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
  },
});
