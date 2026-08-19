# 0007 — Rate limiting the write surface

**Status:** Accepted (Phase 4b)

## Context

`docs/product/requirements/ledger.md` line 66 is one sentence — "Write endpoints are rate-limited." It names no layer, no key, and no number. Phase 4a shipped a read-only surface, so nothing had to be decided; Phase 4b is the first phase with writes, and the sentence has to become something specific.

Three questions have to be answered together. **Which layer** the limit lives at determines what it can see. **What it is keyed by** determines who is protected from whom. **What it throws** determines whether the rejection fits the error contract `docs/backend/error-handling.md` already publishes, or becomes the one 4xx a client has to special-case.

## Decision

**The limit is oRPC middleware on `adminProcedure`, not Hono middleware.** This is forced by how `apps/server/src/index.ts` mounts the API. Both handlers sit behind a single catch-all `app.use("/*")`, which hands every request to the RPC handler first and to the OpenAPI handler second; Hono has no per-procedure route to attach anything to, every RPC call is a `POST`, and the only thing distinguishing a balance read from a transfer is the procedure path *inside* the `/rpc` prefix that oRPC — not Hono — resolves. A framework-layer limiter would therefore need a hardcoded allowlist of write paths: a second copy of the procedure ladder, maintained by hand, which drifts from the real one the first time somebody adds an endpoint and forgets the list. `adminProcedure` *is* the write set by construction — all three write procedures sit on it and nothing else does — so attaching the limit there means a new write endpoint inherits it and there is no list to keep in sync.

**The key is `orgId`, with a secondary per-user limit.** `orgId` is the only identifier in the request the database has vouched for: `requireOrg` turned a session claim into an org id only after `resolveMembership` found a real `member` row (ADR 0005), so it cannot be spoofed by the caller. Everything the limit protects is org-scoped anyway — row locks on that org's accounts, its `UNIQUE (org_id, key)` index, contention on its balances. And keying by org guarantees one tenant cannot exhaust another's budget, which is invariant #5 applied to availability rather than to data. `actorId` is already in the same context, so a second, tighter per-user limiter costs one more call.

IP was rejected for four concrete reasons: `Context` carries no headers at all, so the value is not even available; a socket peer address behind a proxy collapses every client into one key and becomes a global kill switch; `X-Forwarded-For` is client-controlled and therefore forgeable by exactly the caller a limit exists to stop; and two organizations behind one NAT would throttle each other.

**60 writes/minute per org, 30/minute per user.** Recorded here rather than left to whoever edits the constant, because `ledger.md` line 66 specifies no number and one had to be chosen. The org ceiling is deliberately conservative: `createDb` configures no pool size and no `statement_timeout`, and an idempotency-key loser blocks for the whole of the winner's posting transaction (ADR 0004), so a generous limit converts directly into pool exhaustion rather than into throughput.

**The limiter runs after the role check.** `adminProcedure = orgProcedure.use(requireWrite).use(applyWriteRateLimit)`, in that order. A caller without write permission must get `403` regardless of anyone's budget, and — the load-bearing half — a rejected viewer must not be able to consume the organization's write quota. Limiting first would hand any authenticated org member a trivial denial of service against that org's admins: 60 refused requests a minute and no admin can post.

**`MemoryRatelimiter` is used; the library's `createRatelimitMiddleware` is not.** The sliding window, its store, and its cleanup come from `@orpc/experimental-ratelimit` and are not hand-rolled. Its middleware is not, because of what it throws (verified in the installed `1.14.12` build):

```js
throw new ORPCError("TOO_MANY_REQUESTS", {
  data: { limit: result.limit, remaining: result.remaining, reset: result.reset }
});
```

No `reason` field, and no `message` either. `docs/backend/error-handling.md` states that `data.reason` is the stable machine-readable contract and that clients switch on `reason`, never on `message` — so that error is the one failure in the whole surface a client would have to detect by HTTP status instead. `enforceLimit` in `packages/api/src/rate-limit.ts` wraps the limiter directly and throws a conforming `TOO_MANY_REQUESTS` carrying `reason: "rate_limited"`, the `scope` that tripped, the `limit`, and a `retryAfterSeconds` floored at 1 (a client told to retry after 0 seconds retries immediately and trips the limit again).

## Consequences

- **Pro:** the write set and the rate-limited set are the same set by construction. A future write endpoint is limited the moment it is put on `adminProcedure`, with no allowlist that can silently fall behind.
- **Pro:** the key cannot be forged, and one tenant cannot degrade another's availability.
- **Pro:** a `429` looks like every other typed failure in this API — one `data.reason` branch shape covers the entire error surface, including this one.
- **Pro:** a viewer cannot spend an org's write budget, because the `403` happens first.
- **Con — the counters are in-process.** They do not survive a restart, so any deploy silently refills every budget, and they are not shared across replicas, so running two instances makes the effective ceiling 120/min per org rather than 60. This is correct for a single-process sandbox and is a real limit to fix before any multi-replica deployment: swap `MemoryRatelimiter` for a shared-store implementation (the package's Redis adapter, or `rate-limiter-flexible` with a Drizzle store). The wrapper's shape does not change; two constructor calls do.
- **Con — the package is named `experimental` and its API may change.** It is pinned through the workspace catalog at `^1.14.12` and versioned in lockstep with `@orpc/server` (installed at `1.14.10`), so an oRPC upgrade drags it along. `MemoryRatelimiter`'s `limit()` result shape is what `enforceLimit` depends on; a breaking change there is a compile error, but a semantic change to the window algorithm would not be.
- ~~**Con — no `RateLimit-*` or `Retry-After` response headers are emitted.**~~ **Closed 2026-08-19 — see the amendment below.** The library's `RatelimitHandlerPlugin` is what sets `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, and `retry-after`, and it has to be registered on the handler constructors in `apps/server`, which was outside this phase's scope. The consequence is concrete: `retryAfterSeconds` is in the response body only, so generic HTTP retry machinery that reads `Retry-After` sees nothing and will back off on its own schedule or not at all.
- **Con — one admin can consume the org's shared budget.** The per-user limit narrows this to half of it, but two busy admins can still exhaust an org's 60/min between them, and a legitimate bulk import through the API is indistinguishable from abuse and throttled identically. There is no per-endpoint or burst allowance.
- **Con — `resetRateLimitersForTesting` reaches into the adapter's private `store` field**, because `MemoryRatelimiter` exposes no reset and the suite shares one process across files. If a future version renames or restructures that field, the helper stops resetting anything *silently* — counters accumulate and one test file's writes start failing the next file's, as product bugs rather than as an obvious helper failure.
- **Con — every rejected request has already cost a database round-trip.** `resolveMembership` runs before the limiter by necessity (it is what produces the key), so the limit protects the ledger's write path and its row locks, not the auth path in front of it.

## Amended 2026-08-19 — the headers are emitted, without adopting the plugin

The `Retry-After` / `RateLimit-*` gap above is closed. The plugin is still not used.

`withRateLimitHeaders` in [`apps/server/src/app.ts`](../../apps/server/src/app.ts) inspects a
response on its way out of either oRPC handler and, **only when the status is `429`**, reads the
body it already contains and projects four headers from it: `Retry-After`, `RateLimit-Limit`,
`RateLimit-Remaining` (always `0`, which is what a 429 means), and `RateLimit-Reset`.

Three things about the shape are deliberate.

**The body stays the source of truth.** The headers are derived from `data`, not computed
alongside it. Registering `RatelimitHandlerPlugin` would have produced a second, independent
opinion about the same limit — and dragged in the non-conforming error shape this ADR rejected in
the first place, since the plugin is the companion to the middleware whose missing `data.reason`
was the original objection.

**Only a `429` is buffered.** Reading a body to derive a header means the response can no longer
stream. That is acceptable for the throttled path and unacceptable for every other one, so the
branch returns the untouched response first. In any normal minute nothing is buffered at all.

**The headers are CORS-exposed.** The console is a different origin, and a browser hides every
non-safelisted response header unless the server names it in `Access-Control-Expose-Headers`.
Without that list the headers would be on the wire and unreadable by the only client this API
ships with — present, correct, and useless.

The console still reads the body rather than the headers, deliberately: it needs `scope` to tell
the user *whose* budget ran out, and no standard header carries that.

What this does **not** change: the counters are still in-process, so the first Con above stands
unamended. Emitting an accurate `Retry-After` from one replica says nothing about what a second
replica's counter thinks.
