import { defineConfig } from "vitest/config";

/**
 * Root Vitest config — a project index, nothing more.
 *
 * Each workspace package owns its own `vitest.config.ts`; this file only points
 * at them so `pnpm test:watch` can run every suite in one process from the repo
 * root. CI and `pnpm test` go through Turborepo instead (`turbo run test`), which
 * runs the same per-package configs with caching and the task graph. Keeping the
 * real config in the packages means the two entry points can never drift.
 *
 * Vitest 4 removed `vitest.workspace.ts`; `test.projects` is its replacement.
 */
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts"],
  },
});
