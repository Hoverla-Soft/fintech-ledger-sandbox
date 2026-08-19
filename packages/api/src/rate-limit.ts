// Subpath is `/memory`, not `/adapters/memory` — the package's exports map
// points `./memory` at `dist/adapters/memory.mjs`, and the dist layout is not
// the public surface.
import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { ORPCError } from "@orpc/server";

/**
 * Rate limiting for the write surface (ADR 0007).
 *
 * ### Why this is oRPC middleware and not Hono middleware
 *
 * `apps/server` mounts both handlers under a single `app.use("/*")`, and every
 * oRPC call — read or write — is a `POST` to one path. A Hono-layer limiter
 * therefore cannot tell a balance read from a transfer without a hardcoded
 * path allowlist that would duplicate the procedure ladder and drift from it.
 * `adminProcedure` **is** the write set by construction, so the limit belongs
 * there: adding a write endpoint automatically inherits it, and no list needs
 * maintaining.
 *
 * ### Why the key is the organization
 *
 * `orgId` is the only identifier in the request the database has vouched for —
 * `requireOrg` validated it against a real `member` row, so it cannot be
 * spoofed. Everything the limit protects is org-scoped too: row locks on that
 * org's accounts, its `UNIQUE (org_id, key)` index, its balance contention.
 * And keying by org guarantees one tenant cannot exhaust another's budget,
 * which is invariant #5 applied to availability rather than to data.
 *
 * IP was rejected: `Context` carries no headers, a socket peer behind a proxy
 * collapses every client into one global key, `X-Forwarded-For` is
 * client-controlled, and two organizations behind one NAT would throttle each
 * other. A secondary per-user limit rides along free, since `actorId` is
 * already in the same context.
 *
 * ### Why `MemoryRatelimiter` is used but the library's middleware is not
 *
 * The sliding-window algorithm, its store, and its cleanup come from the
 * declared dependency — that part is not hand-rolled. Its `createRatelimitMiddleware`
 * is deliberately not used, for two reasons. It throws
 * `ORPCError("TOO_MANY_REQUESTS", { data: { limit, remaining, reset } })` with
 * **no `reason` field**, which contradicts `docs/backend/error-handling.md`'s
 * rule that clients switch on `data.reason` and never on `message`. And its
 * companion `RatelimitHandlerPlugin` — the piece that emits `RateLimit-*` and
 * `Retry-After` headers — would have to be registered on the handler in
 * `apps/server`, and adopting it there would drag its non-conforming error
 * shape back in with it. Those headers arrived instead on 2026-08-19 as
 * `withRateLimitHeaders` in `apps/server/src/app.ts`, which derives them from
 * the `data` block below. So this stays the single source of the 429's
 * contract, and the headers are a projection of it rather than a second
 * opinion that can disagree.
 *
 * ### Known limitation
 *
 * In-process state: correct for this single-process sandbox, lost on restart,
 * not shared across replicas. Deliberate — a shared store means a new declared
 * dependency and an operational component this sandbox has no other use for.
 * ADR 0007 records what to swap in if that ever changes.
 */

const MINUTE_MS = 60_000;

/**
 * Recorded in `docs/tasks/2026-07-27-phase-4b-write-endpoints.md` rather than
 * invented here: `ledger.md` line 66 mandates that writes be limited but names
 * no number. The org ceiling is deliberately conservative because an
 * idempotency-key loser blocks for the whole duration of the winner's posting
 * transaction, so a high limit converts directly into pool exhaustion.
 *
 * The pool is no longer unbounded — `createDb` has carried `statement_timeout`,
 * `idle_in_transaction_session_timeout`, and a connection timeout since the
 * Phase 3 deferral this comment used to cite was closed. The limit stays where
 * it is regardless: a timeout turns exhaustion into a slow error rather than
 * preventing the contention that caused it.
 */
export const WRITES_PER_MINUTE_PER_ORG = 60;
export const WRITES_PER_MINUTE_PER_USER = 30;

export const orgWriteLimiter = new MemoryRatelimiter({
  maxRequests: WRITES_PER_MINUTE_PER_ORG,
  window: MINUTE_MS,
});

export const userWriteLimiter = new MemoryRatelimiter({
  maxRequests: WRITES_PER_MINUTE_PER_USER,
  window: MINUTE_MS,
});

/**
 * Applies one limiter and throws a **conforming** `429` when it trips.
 *
 * `retryAfterSeconds` is derived from the limiter's `reset` timestamp and
 * floored at 1: a client told to retry after 0 seconds will retry immediately
 * and trip the limit again.
 */
export async function enforceLimit(
  limiter: MemoryRatelimiter,
  key: string,
  scope: "organization" | "user",
): Promise<void> {
  const result = await limiter.limit(key);

  if (result.success) {
    return;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));

  throw new ORPCError("TOO_MANY_REQUESTS", {
    message: "Too many write requests. Retry shortly.",
    data: {
      // The field the library omits and this repo's error contract requires.
      reason: "rate_limited",
      scope,
      limit: result.limit,
      retryAfterSeconds,
    },
  });
}

/** Test-only: drops all accumulated counters so one test's writes cannot exhaust the next test's budget. */
export function resetRateLimitersForTesting(): void {
  for (const limiter of [orgWriteLimiter, userWriteLimiter]) {
    // `MemoryRatelimiter` keeps window state in a private `store` Map and
    // exposes no reset. Confined to this one helper rather than spread across
    // tests, which share a process and would otherwise trip the limit.
    const store = (limiter as unknown as { store?: Map<string, unknown> }).store;
    store?.clear();
  }
}
