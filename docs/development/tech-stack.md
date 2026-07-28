# Tech stack

The single source of truth for which technologies this project uses. Every skill and agent in this repo is written generically on purpose — none of them hardcode a framework name. If an agent needs to know "React or Vue," "Zustand or Redux," "Drizzle or Prisma," it reads this file. Keep it current when a stack decision changes.

This project was scaffolded with **Better-T-Stack** (`create-better-t-stack`, see `bts.jsonc` for the reproducible command) and then brought up to the HoverlaSoft engineering standard's package boundaries (see `docs/development/architecture.md`). It is the reference implementation for the standard — a payments-style, double-entry, multi-tenant fintech ledger sandbox.

## Core

| Layer | Choice |
|---|---|
| Package manager | pnpm (workspaces + catalog) |
| Monorepo tool | Turborepo |
| Language | TypeScript (strict; `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`). All **8** workspaces extend `packages/config/tsconfig.base.json` as of Phase 6a — `apps/web` was the last holdout and overrides only `lib`/`types`/`jsx`/`rootDirs`/`paths`, since the base targets Node and web is the sole browser workspace |
| Frontend framework | React 19 + Vite |
| Backend framework | Hono |
| Database | PostgreSQL (local via Docker Compose — `packages/db/docker-compose.yml`) |
| ORM | Drizzle ORM + drizzle-kit |
| Runtime / deployment target | Node.js (`@hono/node-server`); sandbox runs locally |

## Companion libraries

Filled from actual decisions for this project (see the grilling record and `docs/adr/`), not from habit.

| Concern | Choice |
|---|---|
| Routing | TanStack Router (web) |
| Client state | React state / TanStack Query cache (no separate global store unless a need appears) |
| Server state / data fetching | TanStack Query via `@orpc/tanstack-query` |
| HTTP client | oRPC client (`@orpc/client`) over fetch; typed end-to-end |
| Forms | **`@tanstack/react-form`** — corrected 2026-07-28 (Phase 5a, decision D2). This row previously read "React Hook Form (add when first form lands)". The form landed and was built on `@tanstack/react-form` (`apps/web/src/components/sign-in-form.tsx:4,19`); `react-hook-form` is imported by zero files and survives only as a peer of the unused `@hookform/resolvers`, which Phase 5b removes. The declaration is corrected to the code rather than two working forms rewritten to satisfy a stale line. Validation is raw Zod via Standard Schema in `validators.onSubmit`, not a resolver adapter |
| Validation | Zod (shared schemas; oRPC `@orpc/zod`) |
| API layer (REST / RPC / GraphQL) | **oRPC** — typed RPC at `/rpc`, plus generated **OpenAPI** reference at `/api-reference` |
| Auth framework / session management | **Better Auth** (`packages/auth`) + **organization plugin** for multi-tenancy |
| Identity protocols / providers | Email + password (v1); session cookies. OAuth/passkeys are future extensions |
| Testing framework | Vitest 4 (unit) — installed and wired with the `packages/core` domain suite in Phase 2. Integration testing against a real DB is wired in Phase 3 via `@testcontainers/postgresql` (`packages/db`'s Testcontainers harness, `src/test/setup.ts`) — requires a reachable Docker daemon; see `docs/development/testing-rules.md`. Phase 4a added the `packages/api` suite, which consumes that same harness through `packages/db`'s curated `./testing` subpath export rather than duplicating it. **Phase 5a added the `apps/web` console suite** — Vitest with `happy-dom` as the DOM environment, plus `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom`. Approved 2026-07-28 (Phase 5a, decision D1) and catalogued in `pnpm-workspace.yaml` before installation. It is a real DOM environment rather than a Node one because the console's highest-risk behaviours are not pure — *"drawers/modals close only after the request resolves"* and *"failed mutations keep the form open with the reason inline"* (`docs/product/requirements/ledger.md:75-76`) cannot be asserted without a document. 5a itself uses only the Node half; 5b is the first slice to render. Playwright (e2e) is planned but **not yet installed** |
| CSS / styling | Tailwind CSS v4 |
| UI primitives | **Base UI (`@base-ui/react`)** — corrected 2026-07-28 (Phase 5a, decision D3). This row previously read "Radix UI (via shadcn/ui)". Every primitive in `packages/ui` is `@base-ui/react` and composes via its `render` prop, **not** Radix's `asChild` (`apps/web/src/components/mode-toggle.tsx:17`, `user-menu.tsx:34`). shadcn/ui remains the component *source* — its current registry emits Base UI — so the design-system row below is unchanged. Reach for Base UI's API, not Radix's |
| Component library / design system | shadcn/ui in `packages/ui` (shared design system) |
| Logging | Hono logger (dev); structured logger (pino) added with the API hardening phase |
| Error monitoring | none (sandbox) |
| Metrics / tracing | none (sandbox) |
| Security headers middleware | Hono middleware (CORS configured; security headers added in the API hardening phase) |
| Rate limiting | **`@orpc/experimental-ratelimit`** — attached at the oRPC layer to `adminProcedure`, not at the Hono layer. Every oRPC call is a `POST` to one mounted path, so a framework-layer limiter could not tell a write from a read without a path allowlist duplicating the procedure ladder; `adminProcedure` *is* the write set by construction. Keyed by `orgId` (server-derived and membership-verified), with a secondary per-user limit. Wrapped so its `TOO_MANY_REQUESTS` carries a `data.reason`, which the library omits. See ADR 0007 |
| Linter + formatter | **Biome 2.5.6** (`@biomejs/biome`) — added Phase 6a, approved by the user 2026-07-28, catalogued in `pnpm-workspace.yaml` before installation. One binary covering **both** roles: this repo had no linter *and* no formatter (no `.prettierrc*`, no `eslint.config.*`, and no workspace package defining a `lint` script), so oxlint — a linter only — would have closed one gap and left the other, or required Prettier alongside it. Configured from Biome's `recommended` rule set in the root `biome.json`; every deviation carries a written reason on the adjacent line, because narrowing a ruleset until it passes is the failure this slice exists to fix. Run via `pnpm lint`, which fans out through Turborepo to all 8 workspace packages |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`) — added Phase 6a. Runs the same five commands a task file's Verification block declares (`lint`, `check-types`, `test`, `build`, migration integrity guard) on push and pull request. Postgres runs as a **service container** because the `packages/db` and `packages/api` suites drive `@testcontainers/postgresql` and need a reachable Docker daemon — without it those suites would be skipped rather than run, reporting green while checking nothing. See `docs/development/infrastructure.md` |

## Migration workflow

- `drizzle-kit generate` produces SQL migration files into **`packages/db/drizzle/`** (out-dir aligned to the standard's `migration-integrity-guard`, which watches `packages/db/drizzle`).
- `drizzle-kit migrate` applies them. `db:push` is used only for throwaway local iteration, never as the migration of record.
- Applied migrations are immutable; corrections roll forward as new migrations. Seeds must be idempotent.

## Package layout note (divergence from the template's build contract)

Better-T-Stack's internal packages export TypeScript **source** directly (`"exports": { ".": "./src/index.ts" }`) rather than built `dist/` artifacts. This is a deliberate, documented divergence from the template's "consume via `dist`" workspace build contract — it is the modern Turborepo "internal packages" pattern (transpilation handled by each app's bundler: Vite for web, tsx/tsdown for the server). The boundary discipline the standard cares about (no cross-package `src` reaching *around* the public entry point, one-way dependency direction) is preserved; only the physical `dist` requirement is relaxed. See `docs/adr/` for the decision record.

## Status

- [x] Backend observability: sandbox uses console/Hono logger; error monitoring + metrics explicitly `none`. Structured logging (pino) tracked for the API hardening phase — **not** delivered by Phase 4a, which only narrowed error logging to unexpected failures (`apps/server`'s `logUnexpectedError`). Rate limiting and security headers are likewise still outstanding; see `docs/backend/error-handling.md`'s verification checklist for what remains open and what would close it.
- [x] All rows above are filled or explicitly `none`.
- [x] Every declared package is installed and in the lockfile (`pnpm-lock.yaml`). Run `pnpm install` after changing this file.
