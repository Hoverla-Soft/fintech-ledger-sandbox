# 0005 — Tenant isolation at the API boundary

**Status:** Accepted (Phase 4a)

## Context

Invariant #5 — no read or write ever crosses an org boundary — has two halves. ADR 0003 delivered the schema half in Phase 3: every ledger table carries `org_id`, every repository filters on it, `ledger_posting`'s composite foreign keys let Postgres itself reject a row whose org disagrees with its account's, and a cross-org lookup reports the same `AccountNotFound` a missing row would.

None of that answers the question Phase 4 raises: **where does `org_id` come from?** A repository that faithfully filters on whatever org it is handed is only as isolated as its caller. If any endpoint accepted an organization identifier from the request, every guarantee in ADR 0003 would reduce to "the client asked nicely."

Better Auth's organization plugin stores the acting org on the session as `session.activeOrganizationId`. That is convenient but is not, by itself, a trustworthy source: it is caller-influenced state, it can be stale (naming an org the user has since been removed from), and treating it as authoritative would make tenant isolation depend on a mutable field rather than on a fact.

There is also a smaller question with a large failure mode: what status a cross-tenant request receives. `403` and `404` both feel defensible, and choosing per-endpoint by instinct produces an oracle — if "exists but forbidden" and "does not exist" are distinguishable, a caller can enumerate another tenant's ids without ever reading a row.

## Decision

**The acting organization is derived from a verified membership, never accepted as input.**

1. **No procedure input schema in `packages/api` contains an `orgId`, `organizationId`, or equivalent field.** This is not a convention: `packages/api/src/routers/no-org-input.test.ts` walks the real router, introspects the real Zod schemas, and fails if one appears. The test also asserts the procedure count and proves it can read a known field, so a broken introspection cannot pass vacuously.

2. **`session.activeOrganizationId` is a claim, not a fact.** `orgProcedure` (`packages/api/src/procedures.ts`) resolves it through a `member` lookup for `(activeOrganizationId, session.user.id)` and uses the org id from that row. A session naming an org the user never joined, or was removed from, fails the lookup. One query yields both the verified org and the role, so verification costs nothing extra over reading the role.

3. **Access-control lives in the procedure ladder, not in handlers.** `publicProcedure` → `protectedProcedure` → `orgProcedure` → `adminProcedure`. Which rung a procedure is built on is its authorization decision, so a permission cannot be present in one endpoint and quietly missing from its neighbour.

4. **Status codes are assigned by category, not per endpoint.** Addressing a resource that is missing *or* belongs to another org is always `404`, byte-identical in code, message, and body. `403` means only "you may not act in this organization" and is used for both "not a member" and "no active organization" — including when the named org does not exist, so organizations are not enumerable either. `403` is never emitted by the domain-error map (`packages/api/src/errors.ts`), only by middleware.

## Consequences

- **Pro:** tenant isolation no longer depends on every future endpoint author remembering to filter. The only way to obtain an `orgId` inside a handler is through the middleware that verified it.
- **Pro:** the "no org in input" rule is machine-checked, so Phase 4b's write endpoints and anything after cannot reintroduce the hole without a red test.
- **Pro:** revocation is immediate. The role and membership are re-read on every org-scoped request rather than cached in the session, so a demotion or removal takes effect on the next request with no sign-out and no stale-elevation window.
- **Pro:** a caller cannot distinguish "another tenant's account" from "no such account", nor "another tenant's org" from "no such org".
- **Con — one extra query per org-scoped request.** Every read now costs a `member` lookup before its real work. It is a single indexed row (`member_organizationId_idx`, `member_userId_idx`) and is not cached deliberately: caching it would reintroduce exactly the stale-authorization window this ADR removes. If it ever shows up in a profile, the fix is a short-TTL cache with explicit invalidation on membership change — a decision that should get its own ADR, not a quiet optimization.
- **Con — this ADR governs `packages/api` only.** A future background job, migration script, or seed routine that talks to `packages/db` directly bypasses the middleware entirely and must derive `org_id` some other way. ADR 0003's composite foreign keys still prevent it from writing a *structurally* cross-org row, but nothing stops it from reading one. Phase 4c's seed/reset is the first such caller and must address this explicitly.
- **Con — `activeOrganizationId` remains the only signal of intent.** A user who belongs to several organizations acts in whichever one the session names; the API offers no per-request override, by design, since accepting one would be accepting org as input. Switching orgs is a Better Auth session operation, not a ledger API concern.
