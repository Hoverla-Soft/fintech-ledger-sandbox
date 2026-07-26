# Architecture

## Package boundaries

The real package list for this repo. `backend-architecture-guard` reads this section to know what boundaries to enforce; `.claude/guard-routes.json` routes edits in each path to the matching guard skills.

| Package | Owns |
|---|---|
| `apps/server` | The deployable HTTP app: Hono server, mounts the oRPC handlers (`/rpc` + OpenAPI `/api-reference`) and the Better Auth handler (`/api/auth/*`), CORS, request logging, process lifecycle. Thin — no domain logic. |
| `apps/web` | The React + TanStack Router console (the "sandbox" UI). Routes, screens, layouts, feature components. Consumes the oRPC router **types** from `packages/api`. |
| `packages/api` | The oRPC layer: procedures (`publicProcedure`/`protectedProcedure`), middleware (auth, org/tenant context), routers, and the app router type exported to the web client. Orchestrates use-cases by calling `packages/core` (domain) and `packages/db` (persistence). No raw SQL, no React. |
| `packages/core` | **The domain. Pure, zero-infrastructure.** Money value object (bigint minor units), balanced `Transaction`/posting model, account rules, and the ledger invariants encoded so illegal states are unrepresentable. Depends on nothing but TypeScript + Zod. Unit-tested with no database. This is the heart of the showcase. |
| `packages/db` | Persistence only: Drizzle schema, the Postgres client, repositories, and the atomic posting routine (transaction + row locks). Migrations live in `packages/db/drizzle/`. Knows nothing about HTTP. |
| `packages/auth` | Better Auth configuration (Drizzle adapter, organization plugin, session config). The identity/tenancy source of truth. |
| `packages/contracts` | *(added as needed)* Shared Zod schemas / DTOs that must be referenced by more than one package without pulling in runtime service logic. When a schema is only used inside `packages/api`, it stays there. |
| `packages/integrations` | *(none in v1)* Third-party provider clients/adapters. The sandbox has no external providers; this package appears only if one is added (e.g. a real payment rail), and then only behind a normalized interface. |
| `packages/ui` | Shared design system: shadcn/ui components, tokens, themes, global styles, icons. Consumed by `apps/web` through public exports. |
| `packages/env` | Environment variable schemas (server + web), validated with Zod. The single place env is parsed. |
| `packages/config` | Shared `tsconfig.base.json` and other cross-package tool config. |

Dependency direction is one-way and enforced: `apps/*` → `packages/api` → (`packages/core`, `packages/db`, `packages/auth`) → (`packages/env`, `packages/config`). **`packages/core` depends on none of the others** — that purity is the property the reference implementation exists to demonstrate.

### Workspace package build contract

Internal workspace packages are consumed through their package name and public `package.json` `exports`. In this repo those exports point at TypeScript **source** (`./src/*.ts`), not `dist/` — Better-T-Stack's "internal packages" convention, transpiled by each consuming app's bundler (Vite for `apps/web`, tsx/tsdown for `apps/server`). This is a deliberate, documented relaxation of the template's dist-build contract; see `docs/development/tech-stack.md` → "Package layout note" and the ADR. The invariants that still hold:

- A consumer imports another package only through its public entry point (`@fintech-ledger-sandbox/<pkg>` or a declared subpath export), never by reaching into internal file paths.
- The dependency graph is acyclic and one-way (above). `packages/core` imports nothing from siblings.
- TypeScript `paths` must not redirect a package import in a way that hides broken exports.

### Shared UI boundary

`packages/ui` owns reusable visual primitives and cross-app policies (tokens, theming, reset/global styles, icons, component variants). `apps/web` owns its own routes, screens, layouts, and app-specific components. Promote a component into `packages/ui` only when it is intentionally part of the shared design system, not merely because it might be reused someday.

## Provider abstraction model

The sandbox integrates no third-party providers in v1 (fake money, no real rails). If one is ever added (e.g. a real payment processor to move money in/out), it goes in `packages/integrations` behind a normalized interface, and `packages/core`/`packages/api` work only with normalized domain types — never a provider's raw payload shape. Raw payloads may be persisted for debugging (`rawPayload: jsonb`) but never drive domain logic.

## Data flow

A write (post a transfer) flows:

```
apps/web (console)
  → oRPC client (typed)
  → apps/server (Hono) → rpcHandler
  → packages/api procedure
        • auth + org/tenant context middleware (from packages/auth session)
        • build a domain Transaction via packages/core  ← invariants enforced here (balanced, currency-matched, non-negative)
        • call packages/db repository: ONE Postgres transaction
              - SELECT ... FOR UPDATE on the involved accounts (ordered, deadlock-safe)
              - funds check inside the lock
              - insert postings (append-only) + update materialized balances
              - record idempotency key (unique constraint) + audit log
  → typed result back to the web client
```

Reads (balances, postings, reconciliation) go `apps/web → packages/api → packages/db` read repositories, always org-scoped. The reconciliation check (`Σ postings == account.balance`) is exposed as a verify endpoint and asserted in tests.
