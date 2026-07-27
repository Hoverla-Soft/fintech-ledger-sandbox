# API request flow

How a request moves through the backend layers in this repo. The API layer is **oRPC** (see `docs/development/tech-stack.md`): typed RPC at `/rpc`, with the same procedures exposed as an OpenAPI document and reference UI at `/api-reference`.

## Flow

```
apps/web (or any client)
  → POST /rpc/<namespace>/<procedure>            apps/server (Hono)
  → RPCHandler / OpenAPIHandler                  @orpc/server
  → createContext                                packages/api/src/context.ts
        • Better Auth session ← cookie
        • the process-wide Db handle
  → procedure ladder                             packages/api/src/procedures.ts
        • protectedProcedure  → 401 if no session
        • orgProcedure        → 403 unless a member row verifies the acting org
        • adminProcedure      → 403 unless the ledger role is admin
  → Zod input validation                         packages/api/src/contracts/*
  → handler                                      packages/api/src/routers/*
        • domain rules            → packages/core   (Money, Transaction, applyDelta)
        • persistence             → packages/db     (repositories, postTransaction)
  → wire mapping                                 packages/api/src/contracts/wire.ts
  → typed response
```

## Conventions

**Where auth and session context is attached.** In `createContext`, once per request. It resolves the Better Auth session from the request's cookies and adapts it into `LedgerSession` — this package's own minimal `{ userId, activeOrganizationId }` shape — so routers never depend on Better Auth's generic session type, and tests can build a context from a plain object.

**Where the tenant is decided.** In `orgProcedure`, never in a handler and never from input. `activeOrganizationId` is treated as a claim until a `member` lookup confirms it; the verified value is what every downstream `org_id` filter receives. No procedure input schema may contain an org field, and a test enforces that. See ADR 0005.

**Where the database handle comes from.** One `createDb()` at module scope in `context.ts`, injected through the context. `packages/db` exposes no singleton by design, so `packages/api` owns the single `pg.Pool` for the process. Building one per request would open a pool per request.

**Where validation happens.** Zod at the contract boundary only — shapes, id formats, page-size bounds, cursor decoding, and a length cap on decimal amount strings. Domain rules (balanced postings, currency agreement, sufficient funds) live in `packages/core` and are never restated in a handler; the ledger's invariants have exactly one implementation each.

**How errors become responses.** Handlers receive typed `Result`s from `packages/db` and pass failures to `toORPCError` (`packages/api/src/errors.ts`), the single translation point from domain/persistence errors to HTTP. `packages/core` and `packages/db` deliberately know nothing about status codes. See `docs/backend/error-handling.md` for the full table.

**How money and timestamps cross the boundary.** Amounts are decimal strings with an explicit currency (`{ amount: "12.34", currency: "USD" }`), encoded via `Money.format()` and decoded via `Money.parse()` — never a JSON number, which would reintroduce the floating-point imprecision ADR 0002 exists to prevent, and never a raw `bigint`, which `JSON.stringify` cannot serialize at all. Timestamps are ISO-8601 strings. `org_id` is stripped from every response.

**How pagination works.** Cursors are opaque base64url tokens. Callers may only echo back a cursor the server issued, so the `(created_at, id)` sort key stays an implementation detail. A malformed cursor is `400`, not a silent empty page.

**Where request logging happens.** Hono's `logger()` middleware for access logs, in `apps/server`. Error logging is deliberately selective: `logUnexpectedError` skips typed `ORPCError`s below 500, because an expected `404` or `403` is normal control flow rather than an incident, and logging them buries real faults.

See `docs/development/architecture.md` for the package boundaries these layers correspond to, and `backend-architecture-guard` for what it checks at each layer.
