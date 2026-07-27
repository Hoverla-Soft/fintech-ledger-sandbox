# Testing rules

## Framework & setup

| Item | Value |
|---|---|
| Framework | Vitest 4 |
| Test location | `packages/core/src/**/*.test.ts`, `packages/db/src/**/*.test.ts` — colocated with the source file it covers (e.g. `money/money.ts` ↔ `money/money.test.ts`) |
| Test type | `packages/core`: unit — no database, no HTTP, no I/O of any kind. `packages/db`: **integration** — real Postgres via Testcontainers (Phase 3+); requires a reachable Docker daemon |

## Running tests

```bash
pnpm test          # all tests (turbo runs each package's `test` task; root config also indexes per-package vitest.config.ts files)
pnpm test:watch    # watch mode
```

## `packages/db`'s integration suite (Testcontainers)

- `src/test/setup.ts` is the harness. `startTestDatabase()` boots a Postgres container, applies every migration in `packages/db/drizzle/` via drizzle-kit's own migrator, and returns a `{ db, reset, stop }` handle. `connectTestDatabase(connectionString)` instead binds to an already-running Postgres instance without starting a new container. Both are internal to `packages/db` (not part of its public export map) — only that package's own `*.test.ts` files import either, via a relative path.
- Two container-lifecycle patterns coexist, by file:
  - **Per-file container** (`startTestDatabase()`): start the container **once per test file**, in `beforeAll`; call `.reset()` in `beforeEach` to wipe rows between tests without paying the container-startup cost again; `.stop()` in `afterAll`. Right for a file that must own its container's full lifecycle in isolation — this package's original smoke test (`posting/post-transaction.test.ts`) uses this.
  - **One shared container for the whole run** (`connectTestDatabase(inject("dbTestConnectionString"))`): `src/test/global-setup.ts` is wired via `vitest.config.ts`'s `globalSetup` option and starts exactly one Postgres container before any test file in this project runs, providing its connection string to every file via Vitest's `provide`/`inject`. The acceptance suite covering `docs/product/requirements/ledger.md`'s invariants #2–#8 (`posting/post-transaction.atomicity.test.ts`, `posting/post-transaction.concurrency.test.ts`, `repositories/tenant-isolation.test.ts`, `schema/ledger-immutability.test.ts`, `posting/ledger-scenarios.test.ts`, `repositories/reconciliation.test.ts`) uses this pattern instead of paying a fresh Testcontainers cold start per file. `vitest.config.ts` also sets `fileParallelism: false` for this reason: every file in this project must run strictly one at a time, so two files can never run concurrently and truncate the shared container's tables out from under each other via `.reset()`.
- `packages/db/vitest.config.ts` sets `SKIP_ENV_VALIDATION` via Vitest's `env` config option — necessary because `packages/db/src/index.ts` imports `@fintech-ledger-sandbox/env/server` at module scope, which validates `DATABASE_URL` at import time with no root `.env` to satisfy it. Every test builds its own `Db` from the Testcontainers-allocated connection string instead of the unvalidated env var. `global-setup.ts` runs in Vitest's own process rather than a worker, so it sets `SKIP_ENV_VALIDATION` itself (before a *dynamic* `import()` of `../index`) instead of relying on `test.env` reaching that process.
- Requires a running Docker daemon. A failure to reach Docker must surface as a clear, loud error — never a silently skipped suite. Don't stub, mock, or weaken these tests to make them pass without Docker.
- `turbo.json` opts this package's `test` task out of Turborepo's cache (`"@fintech-ledger-sandbox/db#test": { "cache": false }`) — a cached "pass" would replay a stale result without ever touching Docker this run, which is worse than rerunning. `packages/core`'s fast unit suite keeps the default cached `test` task.

## Conventions

- Tests live next to the code they cover (`src/**/*.test.ts`), not in a separate `__tests__` tree — this is the convention as each new package adds its own suite, not only for `packages/core`.
- `packages/core` is a pure domain package: its tests must never require a database, network call, filesystem access, or any other I/O. If a future package's tests need a real dependency (e.g. Postgres for `packages/db`), that is integration-type testing and must be declared as such in this table when it lands, not silently mixed into a package documented as unit-only.
- New backend logic (services, mappers, adapters) needs a test proving it works with a mocked provider interface, not a real external call.
- New API routes need at least one test covering the happy path and one error case.
- Configuration is executable behavior. Changes to `tsconfig*.json`, package/workspace manifests, lint, test, build, bundler, framework, deployment, or environment-schema config need an automated check using the owning tool, plus a focused regression test when typecheck/lint/test/build does not fully exercise the changed behavior.
- Cover valid resolution and the relevant failure mode: missing values/files/packages, invalid or unsupported options, broken `extends`/project references, stale aliases/paths, and workspace overrides. Use safe fixtures; never test or commit real secrets.
- JSON parsing alone is insufficient for JSONC or tool-owned config. Prefer the owning tool's parser or inspection command; for TypeScript, use the project's actual typecheck/`tsc` resolution so inheritance and references are evaluated.
- Treat `.mcp.json` and MCP permission entries as executable configuration. Validate them with `claude mcp list/get` and `/mcp`, confirm exact tool-name matching, and perform a non-destructive read smoke test against the intended workspace/project. Never exercise mutation tools as a generic test.
- Frontend: no test suites required by default in this template — decide per project and record the decision in `docs/open-questions.md` if coverage is intentionally deferred.
- Update `docs/test-coverage.md` when adding a new test suite — one entry per file, one line per thing it covers. Don't let it drift from what actually exists.
