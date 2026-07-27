# Tech stack

The single source of truth for which technologies this project uses. Every skill and agent in this repo is written generically on purpose — none of them hardcode a framework name. If an agent needs to know "React or Vue," "Zustand or Redux," "Drizzle or Prisma," it reads this file. Keep it current when a stack decision changes.

This project was scaffolded with **Better-T-Stack** (`create-better-t-stack`, see `bts.jsonc` for the reproducible command) and then brought up to the HoverlaSoft engineering standard's package boundaries (see `docs/development/architecture.md`). It is the reference implementation for the standard — a payments-style, double-entry, multi-tenant fintech ledger sandbox.

## Core

| Layer | Choice |
|---|---|
| Package manager | pnpm (workspaces + catalog) |
| Monorepo tool | Turborepo |
| Language | TypeScript (strict; `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`) |
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
| Forms | React Hook Form (add when first form lands) |
| Validation | Zod (shared schemas; oRPC `@orpc/zod`) |
| API layer (REST / RPC / GraphQL) | **oRPC** — typed RPC at `/rpc`, plus generated **OpenAPI** reference at `/api-reference` |
| Auth framework / session management | **Better Auth** (`packages/auth`) + **organization plugin** for multi-tenancy |
| Identity protocols / providers | Email + password (v1); session cookies. OAuth/passkeys are future extensions |
| Testing framework | Vitest 4 (unit) — installed and wired with the `packages/core` domain suite in Phase 2. Integration testing against a real DB is wired in Phase 3 via `@testcontainers/postgresql` (`packages/db`'s Testcontainers harness, `src/test/setup.ts`) — requires a reachable Docker daemon; see `docs/development/testing-rules.md`. Phase 4a added the `packages/api` suite, which consumes that same harness through `packages/db`'s curated `./testing` subpath export rather than duplicating it. Playwright (e2e) is planned but **not yet installed** |
| CSS / styling | Tailwind CSS v4 |
| UI primitives | Radix UI (via shadcn/ui) |
| Component library / design system | shadcn/ui in `packages/ui` (shared design system) |
| Logging | Hono logger (dev); structured logger (pino) added with the API hardening phase |
| Error monitoring | none (sandbox) |
| Metrics / tracing | none (sandbox) |
| Security headers middleware | Hono middleware (CORS configured; security headers added in the API hardening phase) |

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
