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
- ~~**Con — this ADR governs `packages/api` only.**~~ **Closed 2026-08-18 — see the amendment below.** A future background job, migration script, or seed routine that talks to `packages/db` directly bypasses the middleware entirely and must derive `org_id` some other way. ADR 0003's composite foreign keys still prevent it from writing a *structurally* cross-org row, but nothing stops it from reading one. Phase 4c's seed/reset is the first such caller and must address this explicitly.
- **Con — `activeOrganizationId` remains the only signal of intent.** A user who belongs to several organizations acts in whichever one the session names; the API offers no per-request override, by design, since accepting one would be accepting org as input. Switching orgs is a Better Auth session operation, not a ledger API concern.

---

## Amended 2026-08-18 — the database enforces it too

**Status:** Accepted. Migration `drizzle/0008_row_level_tenancy.sql`, `packages/db/src/tenancy.ts`, `requireOrg` in `packages/api/src/procedures.ts`.

This ADR's own recorded consequence — that it governs `packages/api` only, and that a caller reaching `packages/db` directly could still *read* across tenants — is closed. `docs/open-questions.md` #30 tracked it.

### What changed

Six ledger tables plus `organization` carry a row-level security policy keyed on `current_setting('app.current_org_id')`. Each org-scoped request runs inside a transaction that sets that value and drops into `ledger_app`, an unprivileged role:

```
requireOrg
  ├── resolveMembership(db, ...)          as the owner, before the scope —
  │                                       it reads `member`, and it is what
  │                                       decides what the scope should be
  └── withOrgScope(db, orgId, ...)
        ├── set_config('app.current_org_id', <verified org>, local)
        ├── set_config('role', 'ledger_app', local)
        └── ...the whole handler...
```

Both settings are transaction-local, so they revert at COMMIT and a pooled connection is never handed on still switched.

### Four things worth stating

**A role, not `FORCE`.** A table's owner is exempt from RLS unless the table is also marked `FORCE`, and the application connects as the owner. `FORCE` would have subjected migrations, the Testcontainers truncate harness, and the ~25 test files that insert ledger rows directly — and it would still not be a privilege boundary, since the owner can disable RLS at will. A separate unprivileged role makes the policies bite while the owner keeps its bypass, so none of those paths changed at all.

**Fail-closed, not fail-filtered.** `current_setting('app.current_org_id', true)` is NULL when unset, and `org_id = NULL` is NULL, not true. A query issued as `ledger_app` without a scope therefore matches **no** rows. That is the property worth having: the failure mode of forgetting to scope is an empty result, not another tenant's data.

**`SET LOCAL ROLE`, not a second connection string.** Pointing `DATABASE_URL` at a `LOGIN` role would need a matching change in `docker-compose.yml`, `.env`, and the deployment, plus a second owner URL for `drizzle-kit migrate`. Switching role inside the request transaction reaches the same role with no configuration anywhere. The role is `NOLOGIN` today; granting it `LOGIN` and repointing `DATABASE_URL` is a pure ops change later, because `SET LOCAL ROLE ledger_app` is a no-op when the session already is that role. **What this does not cover:** a script that connects as the owner and never calls `withOrgScope` still sees everything. `withOrgScope` is exported from `packages/db` precisely so such a caller has a door to walk through, but nothing forces it through that door until the connection string moves.

**The scope commits even when the handler throws.** Load-bearing, and the reason `withOrgScope` is not a plain `db.transaction(...)`. `postTransaction` deliberately writes its rejection audit *after* its own transaction has rolled back — an audit row written inside the failing transaction would roll back with it, leaving `ledger.md` line 54's "every rejection is recorded" unmet. The handler then turns the error `Result` into a thrown `ORPCError`. A scope that rolled back on that throw would discard exactly the row that was written to survive a rollback. So a throw is captured, the transaction commits, and the error is rethrown — leaving atomicity entirely where it already was, in each `postTransaction`'s own nested transaction.

### What it cost elsewhere

One repository needed fixing, at the source rather than around it. `insertPendingTransfer` inserted, caught a `23505`, and read the existing row back on the same connection. That worked only because nothing had a transaction open: the failed insert aborted its own implicit transaction, which then ended. Inside any enclosing transaction the failure aborts *that*, and the read-back returns `25P02 current transaction is aborted` instead of reporting the replay. `posting/reserve-key.ts` has the identical shape and had already solved it by running its insert inside a nested transaction — a SAVEPOINT — so the fix was to apply the established pattern. It is a fragility any future caller opening a transaction would have hit, not an artifact of this change.

### Consequences

- **Pro:** invariant #5 no longer rests on thirty repository functions each remembering a predicate. The predicate is now belt *and* braces.
- **Pro:** it cost no test changes, and gained coverage for free — every one of `packages/api`'s 343 tests drives a real router over a real database, so all of them now exercise the policies. A wrong policy goes red in hundreds of places.
- **Con — every org-scoped request holds a pooled connection for its full duration**, including the rate-limit check that runs inside it. Acceptable at sandbox scale; if connection pressure ever shows up, the fix is to narrow the scope to the repository calls rather than to widen the pool.
- **Con — `packages/auth` and any direct `packages/db` caller still connect as the owner** and bypass all of this. See the third point above.
