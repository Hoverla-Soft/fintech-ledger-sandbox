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

## Write flow

The three write procedures — `accounts.create`, `transactions.create`, `transactions.reverse` — sit on `adminProcedure` and share the path below. `accounts.create` leaves it after the repository call: it writes one row, posts nothing, and records no audit entry. `transactions.create` takes a raw balanced **postings array** rather than a `{source, destination, amount}` transfer shape, so it maps 1:1 onto `Transaction.create`. `transactions.reverse` takes only an id, resolves the original through `getTransactionById(db, orgId, id)` — `ledger_transaction`'s self-FK is org-blind, so the org-scoped read is what stops one tenant reversing another's transaction — and rebuilds the mirrored legs from the **persisted rows**, never from the request body. See ADR 0006.

```
adminProcedure                                 packages/api/src/procedures.ts
      • requireWrite      → 403 insufficient_role unless the ledger role is admin
      • rate limit        → 429 rate_limited, per org then per user, after the role check
  → Zod input validation                       packages/api/src/contracts/*
      • shapes, uuids, at most 100 postings
      • decimalAmountSchema caps each amount string at 30 chars, before BigInt
  → Money.parse per leg                        packages/core
        → invalid_amount / unsupported_currency
  → createPosting per leg                      → non_positive_amount
  → Transaction.create(postings)               → too_few_postings / currency_mismatch /
                                                 unbalanced_transaction
        ↳ on failure: recordRejection, then toORPCError
  → computeRequestHash(transaction, reverses)  packages/api/src/contracts/request-hash.ts
  → postTransaction                            packages/db/src/posting/post-transaction.ts
        one Postgres transaction:
          reserve the idempotency key   → replay | 409 idempotency_conflict
          lock accounts, deduped+sorted → 404 account_not_found | 422 account_inactive
          applyDelta per account        → 422 insufficient_funds
          insert transaction + postings
          update balances
          backfill the idempotency row with the transaction id
          write the "posted" audit entry
  → re-read the committed transaction          getTransactionById
  → wire mapping                               packages/api/src/contracts/wire.ts
  → typed response: the transaction, its postings, and the resulting balances
```

## Conventions

**Where auth and session context is attached.** In `createContext`, once per request. It resolves the Better Auth session from the request's cookies and adapts it into `LedgerSession` — this package's own minimal `{ userId, activeOrganizationId }` shape — so routers never depend on Better Auth's generic session type, and tests can build a context from a plain object.

**Where the tenant is decided.** In `orgProcedure`, never in a handler and never from input. `activeOrganizationId` is treated as a claim until a `member` lookup confirms it; the verified value is what every downstream `org_id` filter receives. No procedure input schema may contain an org field, and a test enforces that. See ADR 0005.

**Where the database handle comes from.** One `createDb()` at module scope in `context.ts`, injected through the context. `packages/db` exposes no singleton by design, so `packages/api` owns the single `pg.Pool` for the process. Building one per request would open a pool per request.

**Where validation happens.** Zod at the contract boundary only — shapes, id formats, page-size bounds, cursor decoding, and a length cap on decimal amount strings. Domain rules (balanced postings, currency agreement, sufficient funds) live in `packages/core` and are never restated in a handler; the ledger's invariants have exactly one implementation each.

**Where idempotency is decided.** In `packages/db`, inside `postTransaction`'s single transaction — `reserveIdempotencyKey` and the database's `UNIQUE (org_id, key)` index decide replay-versus-conflict, never a handler pre-check, which would be racy (ADR 0004). `packages/api` contributes exactly two things. The key itself travels as a field in the request body rather than an `Idempotency-Key` header, because `Context` carries no headers and a header would be invisible to both the OpenAPI reference and the test that introspects every input schema. And `computeRequestHash` derives the fingerprint from the **validated domain payload**, not the raw body: legs sorted by `(accountId, direction, amount)`, amounts as decimal strings, `reversesTransactionId` included, `orgId`/`actorId`/`idempotencyKey` excluded. Sorting is the load-bearing part — `Transaction.deltas()` nets by account before anything is persisted, so two orderings of the same legs have a byte-identical effect and must replay rather than conflict.

**Handlers perform no writes of their own.** Every side effect of a successful post — postings, balance updates, the idempotency row, the audit entry — happens inside `postTransaction`'s one Postgres transaction, so there is no partial state a handler could leave behind. What the handler does after that call is a *read*: it re-loads the committed transaction through `getTransactionById` so a fresh post, an idempotent replay, and `transactions.get` all return the same shape. One consequence is worth stating, because the response cannot distinguish it: balances are current as of the response, not a snapshot as of posting. A fresh post returns balances computed inside the transaction; a replay re-reads `ledger_account.balance` live, so a retry can legitimately return the same immutable transaction with different balances.

**How errors become responses.** Handlers receive typed `Result`s from `packages/db` and pass failures to `toORPCError` (`packages/api/src/errors.ts`), the single translation point from domain/persistence errors to HTTP. `packages/core` and `packages/db` deliberately know nothing about status codes. See `docs/backend/error-handling.md` for the full table.

**Where rejections get audited.** In two places, because the write path has two distinct failure regions and neither can cover the other. Failures at `Transaction.create` — unbalanced, fewer than two legs, a non-positive amount, a currency mismatch — happen in `packages/api` *before* `postTransaction` is ever called, so its rejection path never sees them; the handler records them itself via `recordRejection` (`packages/db/src/repositories/audit.ts`) and only then throws. Failures discovered inside the posting routine (unknown or cross-org account, inactive account, insufficient funds) and the idempotency conflict are audited by `postTransaction`, which is why the handler re-throws those without recording anything — doing so would double the entry. Both paths write through the same function, always in its own top-level transaction: a rejection audit written inside the transaction that is about to roll back would roll back with it (ADR 0003). An audit-write failure in the handler is logged and swallowed, because turning it into a `500` would replace an accurate `422` with a misleading one.

**How money and timestamps cross the boundary.** Amounts are decimal strings with an explicit currency (`{ amount: "12.34", currency: "USD" }`), encoded via `Money.format()` and decoded via `Money.parse()` — never a JSON number, which would reintroduce the floating-point imprecision ADR 0002 exists to prevent, and never a raw `bigint`, which `JSON.stringify` cannot serialize at all. Timestamps are ISO-8601 strings. `org_id` is stripped from every response.

**How pagination works.** Cursors are opaque base64url tokens. Callers may only echo back a cursor the server issued, so the `(created_at, id)` sort key stays an implementation detail. A malformed cursor is `400`, not a silent empty page.

**Where request logging happens.** Hono's `logger()` middleware for access logs, in `apps/server`. Error logging is deliberately selective: `logUnexpectedError` skips typed `ORPCError`s below 500, because an expected `404` or `403` is normal control flow rather than an incident, and logging them buries real faults.

See `docs/development/architecture.md` for the package boundaries these layers correspond to, and `backend-architecture-guard` for what it checks at each layer.
