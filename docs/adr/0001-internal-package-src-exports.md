# 0001 — Internal packages export TypeScript source, not `dist`

**Status:** Accepted (Phase 1)

## Context

This repo is the reference implementation for the HoverlaSoft engineering standard. The standard's generic `architecture.md` prescribes a "workspace package build contract" where each internal package builds to `dist/` and consumers resolve runtime code + declarations through `dist` exports, never another package's `src`.

The repo was scaffolded with Better-T-Stack, which uses the modern Turborepo **"internal packages"** convention instead: each `packages/*` exposes its public entry point as TypeScript **source** (`"exports": { ".": "./src/index.ts" }`), and each *consuming app* transpiles it through its own bundler — Vite for `apps/web`, tsx/tsdown for `apps/server`. There is no per-package `dist` build step for the pure library packages.

## Decision

Keep Better-T-Stack's internal-packages / src-exports convention rather than forcing a `dist` build contract onto every package.

The boundary properties the standard actually cares about are preserved and still enforced:

- Consumers import a package only through its **public entry point** (`@fintech-ledger-sandbox/<pkg>` or a declared subpath export), never by reaching into internal file paths.
- The dependency graph is **acyclic and one-way**: `apps/*` → `packages/api` → (`core`, `db`, `auth`) → (`env`, `config`). `packages/core` imports nothing from siblings.
- `backend-architecture-guard` and `guard-routes.json` enforce these on every edit.

Only the *physical* `dist` requirement is relaxed.

## Consequences

- **Pro:** no watch-build orchestration, no stale-`dist` foot-guns, instant cross-package changes in dev, simpler mental model — the DX the standard is meant to encourage.
- **Pro:** type inference flows end-to-end (e.g. the oRPC `AppRouter` type from `packages/api` into `apps/web`) without a build step.
- **Con:** consuming a package requires a TypeScript-aware bundler (fine here — every consumer has one). A package published to an external, non-bundled consumer would need a real `dist` build; none exist in this repo.
- **Con:** a documented divergence from the generic standard. Captured here and in `docs/development/tech-stack.md` so it is a deliberate, reviewable choice — exactly the kind of decision the standard expects to be recorded rather than made silently.
