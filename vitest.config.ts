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
    // `apps/*` was added in Phase 5a alongside the `apps/web` console suite.
    // Before that this glob covered `packages/*` only, so an app-level
    // `vitest.config.ts` would have been picked up by `turbo run test` (which
    // walks package manifests) but silently skipped from the repo root — the
    // two entry points this file exists to keep aligned would have disagreed.
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
  },
});
