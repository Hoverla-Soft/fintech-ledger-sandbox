# Roles and permissions: the ledger

The authority `docs/product/requirements/ledger.md` §Permissions points at. Until Phase 4a this file did not exist — `ledger.md` cited a roles document that was only an unfilled `EXAMPLE.md`, so the `admin`/`viewer` model it named had no definition anywhere. This is that definition.

## Roles

Two ledger roles. They are **derived** from Better Auth's organization roles, not stored separately — see "Mapping" below.

| Role | Description |
|---|---|
| `admin` | All reads and all writes within its own organization: create accounts, post transactions, issue reversals. Cannot act outside its organization. |
| `viewer` | Read-only within its own organization: balances, transactions, postings, reconciliation, audit log, rejections. Cannot act outside its organization. |

Neither role is global. There is no super-user, and no role grants any visibility across organizations — that is invariant #5, and it is enforced structurally rather than by role (see "Enforcement").

## Mapping from Better Auth

Better Auth's organization plugin issues `owner` / `admin` / `member`. `ledger.md` specifies `admin` / `viewer`. The two are reconciled at the API boundary by `toLedgerRole` (`packages/api/src/auth/roles.ts`):

| Better Auth `member.role` | Ledger role |
|---|---|
| `owner` | `admin` |
| `admin` | `admin` |
| `member` | `viewer` |
| anything else, including unrecognized values | `viewer` |

**The mapping fails closed.** An unrecognized role string — a value a future Better Auth version introduces, a typo, a hand-edited column — becomes `viewer`, never `admin`. Better Auth also permits multiple roles in one column as a comma-separated list (`"admin,member"`); any single write role in that list is sufficient, so a multi-role member is not silently demoted.

This mapping was chosen over reconfiguring Better Auth with custom roles (which would require migrating every existing `member.role` value) and over rewriting `ledger.md` to adopt the library's vocabulary (the product spec is the durable source of truth; it does not bend to a dependency). See ADR 0005 and `docs/tasks/archive/2026/2026-07-27-phase-3-persistence-ledger-db.md`.

## Permission matrix

| Action | `admin` | `viewer` | Available since |
|---|---|---|---|
| List accounts, get an account + balance | yes | yes | Phase 4a |
| List transactions, get a transaction + postings | yes | yes | Phase 4a |
| Verify reconciliation | yes | yes | Phase 4a |
| Read the audit log and rejections | yes | yes | Phase 4a |
| Create an account | yes | no | Phase 4b |
| Post a transaction | yes | no | Phase 4b |
| Reverse a transaction | yes | no | Phase 4b |
| Seed / reset the sandbox | yes | no | Phase 4c |

Seed and reset are `adminProcedure` procedures like every other write, so they are refused for a `viewer` by the same middleware and for the same reason — there is no separate sandbox-permission concept. Reset is not a privileged or destructive capability in the usual sense: it deletes nothing and posts ordinary balanced transactions, so an admin who can reset could already have posted the same compensating entries by hand. See ADR 0008.

Reconciliation is deliberately readable by a `viewer`: catching drift is not a privileged act, and a viewer who can already see balances and postings can compute the same answer by hand.

## Enforcement

Enforced in middleware in `packages/api/src/procedures.ts`, as a ladder of procedure types. Which rung a procedure is built on *is* its access-control decision — there are no ad-hoc permission checks inside handlers, so a permission cannot be forgotten in one endpoint while being present in its neighbours.

| Rung | Requires | Failure |
|---|---|---|
| `publicProcedure` | nothing | — |
| `protectedProcedure` | a signed-in user | `401` |
| `orgProcedure` | a signed-in user **and** a verified `member` row for the session's active organization | `401` / `403` |
| `adminProcedure` | the above **and** `role === "admin"` | `403` |

Two properties matter more than the table:

1. **The acting organization is derived, never accepted.** No procedure input schema anywhere in `packages/api` contains an `orgId` field; the value comes from a `member` row the database vouched for. A session's `activeOrganizationId` is treated as a *claim* until that lookup confirms it, so a stale or tampered value yields `403` rather than access to another tenant. Asserted mechanically by `packages/api/src/routers/no-org-input.test.ts`, not left to review.
2. **Tenant isolation does not depend on roles at all.** Every repository query filters on `org_id`, and `ledger_posting`'s composite foreign keys make a cross-org row rejectable by Postgres itself (ADR 0003). Role checks decide *what you may do*; they are not what keeps organizations apart.

"The frontend hides the button" is not enforcement anywhere in this system — `apps/web` has no role logic that the API does not independently apply.

## Edge cases

- **A role changes while a session is active.** The role is re-read from the `member` row on *every* org-scoped request, not cached in the session or a token. A demotion from `admin` to `member` takes effect on the caller's next request; no sign-out is required, and there is no window in which a stale elevated role is honoured.
- **A user is removed from an organization while acting in it.** Their session still carries `activeOrganizationId`, but the `member` row is gone, so `orgProcedure` returns `403 not_a_member` from the next request onward. Nothing they previously read is recalled, but nothing further is served.
- **A session has no active organization.** `403 no_active_organization`. This is the normal state for a user who has signed up but not yet created or joined an org; the console is expected to route them to org creation rather than treat it as an error.
- **A user names an organization that does not exist.** Also `403`, with the same body as naming a real organization they do not belong to. Returning `404` for the first case would make the endpoint an existence oracle for other tenants' organizations.
- **Resources owned by a removed or demoted user.** Nothing is reassigned or deleted. `ledger_transaction.created_by` and `ledger_audit_entry.actor_user_id` deliberately have no delete cascade, so financial provenance survives the actor's account (ADR 0003). The practical consequence — a user who has ever posted cannot currently be hard-deleted — is a recorded open consequence, not a decided account-closure model.
- **A member holding several Better Auth roles.** Any write role in the list wins; see "Mapping".
