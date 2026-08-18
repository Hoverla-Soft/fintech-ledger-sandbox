# Roles and permissions: the ledger

The authority `docs/product/requirements/ledger.md` §Permissions points at. Until Phase 4a this file did not exist — `ledger.md` cited a roles document that was only an unfilled `EXAMPLE.md`, so the `admin`/`viewer` model it named had no definition anywhere. This is that definition.

## Roles

Two ledger roles. They are **derived** from Better Auth's organization roles, not stored separately — see "Mapping" below.

| Role | Description |
|---|---|
| `admin` | All reads and all writes within its own organization: create accounts, close and reopen them, post transactions, issue reversals. Cannot act outside its organization. |
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
| Close / reopen an account | yes | no | 2026-08-18 |
| Post a transaction | yes | no | Phase 4b |
| Reverse a transaction | yes | no | Phase 4b |
| Seed / reset the sandbox | yes | no | Phase 4c |
| List pending transfer approvals | yes | yes | Portfolio |
| Submit / approve / reject a pending transfer | yes | no | Portfolio |
| Toggle require-transfer-approval org setting | yes | no | Portfolio |

Seed and reset are `adminProcedure` procedures like every other write, so they are refused for a `viewer` by the same middleware and for the same reason — there is no separate sandbox-permission concept. Reset is not a privileged or destructive capability in the usual sense: it deletes nothing and posts ordinary balanced transactions, so an admin who can reset could already have posted the same compensating entries by hand. See ADR 0008.

**That justification stopped holding on 2026-08-16, and the first attempt to reason around it was wrong.** "Could already have posted the same entries by hand" is false once `requireTransferApproval` is on, because by-hand posting is refused. This file briefly claimed seed and reset were safe to leave ungated because neither "can direct value to a caller-chosen account". An adversarial pass disproved both against a real database: `sandbox.seed`'s funding scenario credits a `normal` account from an `external` one — which is exempt from the negative-balance invariant — and two runs under different keys took an account from 1500.00 to 3000.00, a value faucet; `sandbox.reset` drove every account in the organization to zero, the most destructive balance change the API offers. Both are now on `directPostProcedure` and refused while approvals are on.

Pending-transfer approve/reject are also `adminProcedure`, plus an extra same-actor guard: the submitter cannot decide their own request (`403 self_approve_forbidden`). When org setting `requireTransferApproval` is off (the default), a transfer posts immediately via `transactions.create` and the Approvals queue stays empty.

**When it is on, the server refuses a direct post** — `transactions.create` and `transactions.exchange` both return `403 approval_required`, and the attempt is written to the audit log like any other rejection. This paragraph used to describe maker-checker as *transfer-form* behaviour, and that was the defect: until 2026-08-16 the flag was read only in `apps/web`, so the control shaped what the console offered rather than what the ledger permitted, and any admin could post past the queue with a direct API call. Maker-checker exists to constrain admins, so an admin-shaped bypass is not a lesser case — it is the case.

Two consequences worth stating plainly:

- **Every direct balance change is gated, not just `create`.** `transactions.create` / `reverse` / `exchange` and `sandbox.seed` / `reset` all sit on `directPostProcedure`. Only `approvals.approve` is exempt, because it is the path the gate forces callers onto — it reaches the ledger through `postTransaction` rather than a gated wire procedure, and a test pins that so a future refactor cannot lock an organization out of approving anything.
- **Reversal is gated, and the reasoning that first excluded it was wrong.** "A reversal only mirrors an existing transaction" ignores that reversing a reversal is deliberately permitted: one admin drove an account 100 → 0 → 100 → 0 → 100 with four calls, each under a fresh caller-chosen key. Any historical transfer is a reusable template for moving that pair of accounts without a second approver.
- **Exchange is refused outright while the flag is on.** `ledger_pending_transfer` holds one balanced set of postings and an exchange posts two linked transactions, so there is no approval route for it. Refusing fails closed; the console's exchange screen says so up front rather than letting a user fill in a rate and then fail.
- **Turning the control off is itself audited.** `set_require_transfer_approval` writes an audit entry naming the actor and direction. Without it, flip-off → post → flip-on left a single ordinary `post_transaction` row, indistinguishable from a posting in an organization that never required approval. An admin may disable the control; the trail has to show that they did.

Reconciliation is deliberately readable by a `viewer`: catching drift is not a privileged act, and a viewer who can already see balances and postings can compute the same answer by hand.

## Enforcement

Enforced in middleware in `packages/api/src/procedures.ts`, as a ladder of procedure types. Which rung a procedure is built on *is* its access-control decision — there are no ad-hoc permission checks inside handlers, so a permission cannot be forgotten in one endpoint while being present in its neighbours.

| Rung | Requires | Failure |
|---|---|---|
| `publicProcedure` | nothing | — |
| `protectedProcedure` | a signed-in user | `401` |
| `orgProcedure` | a signed-in user **and** a verified `member` row for the session's active organization | `401` / `403` |
| `adminProcedure` | the above **and** `role === "admin"` | `403` |
| `directPostProcedure` | the above **and** the organization is not requiring approval | `403 approval_required` |

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
