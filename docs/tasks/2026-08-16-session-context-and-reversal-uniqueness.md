# Task: Add `session.context`, and make a transaction reversible only once

## Goal

Two of the three ⚠️ callouts on `docs/showcase/architecture.md` name work that is small and specified; this closes both.

**`session.context`** — `requireOrg` already derives the caller's ledger role and puts it in middleware context, but no procedure returns it. So the console re-derives its own role hint client-side from Better Auth's member row through the shared `toLedgerRole`, and pays a round-trip for it. Open question #1 has recorded that since Phase 5b.

**Reversal uniqueness** — `transactions.reverse` will reverse the same original twice under two different keys, and when balances allow, both succeed and *double the correction*. ADR 0006 records this in its consequences, names the fix ("a partial unique index"), and states plainly that the phase which found it was scoped not to ship it.

Both are narrow. Neither invents a policy: the role already exists server-side, and the index is the fix the ADR already chose.

## Status

Human Review

## Scope (allowed paths)

- `packages/api/src/routers/session.ts`
- `packages/api/src/routers/index.ts`
- `packages/api/src/routers/session.test.ts`
- `packages/api/src/routers/transactions.ts`
- `packages/api/src/routers/writes.test.ts`
- `packages/api/src/errors.ts`
- `packages/api/src/errors.test.ts`
- `packages/db/src/schema/ledger.ts`
- `packages/db/drizzle/**`
- `packages/db/src/posting/post-transaction.ts`
- `packages/db/src/errors.ts`
- `apps/web/src/lib/org/session.ts`
- `apps/web/src/lib/ledger/errors.ts`
- `apps/web/src/lib/ledger/errors.test.ts`
- `apps/web/src/features/transactions/reverse-dialog.tsx`
- `docs/backend/error-handling.md`
- `docs/adr/0006-write-endpoint-contract.md`
- `docs/adr/0009-console-session-and-tenant-model.md`
- `docs/open-questions.md`
- `docs/showcase/architecture.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-16-session-context-and-reversal-uniqueness.md`

## Out of scope

- **Postgres row-level security** (the other half of the third callout). It is real defense-in-depth, but it guards a caller that does not exist — nothing outside `packages/api` talks to `packages/db` today — and it is a materially larger change: `FORCE ROW LEVEL SECURITY` (the owner bypasses RLS otherwise), a session GUC set inside every transaction, and an exemption path for migrations, the Testcontainers harness, and `sandbox.reset`'s deliberate whole-org reads. Recorded as an open question with that shape written down, so the next person starts from the constraints rather than rediscovering them.
- **Blocking a reversal *chain*.** Reversing a reversal is legitimate undo/redo, each step targets a different transaction id, and ADR 0006's reasoning for permitting it stands. The unique index does not touch it.
- `organization.tsx`'s use of `toLedgerRole` — that maps *other* members' roles for a member list, which `session.context` does not answer.

## Related docs

- `docs/adr/0006-write-endpoint-contract.md` → Consequences, the "reverse a reversal" bullet and its 6b update
- `docs/adr/0009-console-session-and-tenant-model.md` → why the console derives the hint client-side today
- `docs/open-questions.md` #1 and #3

## Happy path

1. **`session.context`.** A new `orgProcedure` returning `{ userId, orgId, role }`. It adds no authority — `requireOrg` already resolved and verified all three — it just stops the value being unreachable.
2. **Console reads it.** `useOrgContext` consumes the procedure instead of `toLedgerRole(member?.role)`, dropping both the client-side mapping and the Better Auth member round-trip. It stays an affordance hint; every write is still enforced server-side.
3. **Unique partial index.** `ledger_transaction_reversesTransactionId_idx` becomes `uniqueIndex`, still `WHERE reverses_transaction_id IS NOT NULL`. Generated through `pnpm db:generate` so the Drizzle journal stays consistent with the integrity guard.
4. **Map the violation.** A second reversal of the same original now raises `23505`. Caught in the posting routine and surfaced as a typed `already_reversed`, not an unmapped 500 — every other refusal in this ledger is a typed reason that reaches the audit log.
5. **Console copy.** The reverse dialog already says "already been reversed *n* times"; it now also renders the refusal.

## Acceptance criteria

- [x] `session.context` returns the caller's `userId`, `orgId`, and ledger role
- [x] It is `orgProcedure`, so a viewer can call it and a caller with no active org gets `403 no_active_organization`
- [x] It returns `viewer` for a Better Auth `member`, `admin` for `owner`/`admin` — the same mapping the server enforces with
- [x] `useOrgContext` no longer imports `toLedgerRole`
- [x] Reversing the same transaction twice fails with a typed `already_reversed`, not a 500
- [x] Reversing a *reversal* still works — the chain is untouched
- [x] The Drizzle journal passes `migration-integrity-guard --check`

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
pnpm audit --audit-level=high
```

## Retention

Move to `docs/tasks/archive/2026/` at `Done`. Durable decisions land in ADR 0006, ADR 0009, and `docs/open-questions.md` (#1, #3) first.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — any org member for `session.context` (both roles); an `admin` for reversal
- [x] Entry point defined — `session.context` on the API; the console shell's role hint; the reverse dialog
- [x] Preconditions described — a verified `member` row for the active org; for reversal, an existing transaction in the caller's org
- [x] Happy path described — five ordered steps above
- [x] Error paths described — `403 no_active_organization` / `not_a_member` on `session.context` (both pre-existing, from `requireOrg`); `409 already_reversed` on a second reversal of the same original; `403 approval_required` still applies first when the org requires approval
- [x] Permissions considered — `session.context` is `orgProcedure`, deliberately readable by a `viewer`: it reports the caller's own role and grants nothing. It must not become a way to enumerate other members
- [x] Acceptance criteria written
- [x] Tests defined — role mapping per Better Auth role, no-active-org refusal, second reversal refused, reversal-of-a-reversal still permitted
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `session.context`, input none, output `{ userId, orgId, role }`
- [x] Validation described — no input to validate; the output shape is a Zod schema like every other procedure's
- [x] Error responses defined — reuses `requireOrg`'s existing `403`s; adds `409 already_reversed` on the reversal path
- [x] Side effects listed — none for `session.context` (a pure read of already-resolved context). The unique index changes write behaviour: a duplicate reversal is refused by the database rather than posted

### Frontend
- [x] Loading state defined — `useOrgContext` keeps its `isPending`, now driven by the new query; the role stays fail-closed to `viewer` while unresolved
- [x] Empty state defined — `N/A: no list surface changed`
- [x] Error state defined — a failed `session.context` leaves the hint at `viewer` (fail closed); `already_reversed` renders through the existing `describeFailure` registry
- [x] Navigation after each action defined — unchanged
- [x] Feedback (toast/inline/modal) defined — the reverse dialog surfaces `already_reversed` inline, alongside the existing "reversed *n* times" line

---

*Started 2026-08-16. Follows `2026-08-16-server-side-maker-checker`. RLS is deliberately not here — see Out of scope.*
