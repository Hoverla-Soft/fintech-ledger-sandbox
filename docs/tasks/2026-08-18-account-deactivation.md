# Task: Let an admin close an account, and refuse to strand money doing it

## Goal

`docs/open-questions.md` #8. An account can *be* inactive — the `active` column exists, `lockAccounts` checks it under the row lock, `AccountInactive` maps to `422 account_inactive`, and `accounts.list` already reports `active` on the wire — but **no procedure can set it**. The state is reachable today only by raw SQL, which is exactly what `writes.test.ts` does, with a comment saying so.

So this is not "build account closure". Every part of it exists except the one write. The work is the write, the rule about when it is allowed, and the console affordance.

Outcome: an admin can deactivate an account that holds nothing and reactivate it later; deactivating an account that still holds money is refused with a typed error rather than quietly stranding a balance.

## Status

Human Review

Verified 2026-08-18: `pnpm lint` (265 files, 0 diagnostics) · `pnpm check-types` (6/6) · `pnpm test` (**763 passed** — core 90, server 13, web 297, db 28, api 335) · `pnpm build` (2/2). Local only; CI has still never executed a check (#10).

Two count tripwires fired by name and were updated, which is what they are for: `errors.test.ts`'s published-reason count (27 → 28) and `no-org-input.test.ts`'s procedure census (23 → 25, plus the two new paths in its sorted list).

## Scope (allowed paths)

- `packages/db/src/repositories/accounts.ts`
- `packages/db/src/errors.ts`
- `packages/api/src/routers/accounts.ts`
- `packages/api/src/errors.ts`
- `packages/api/src/routers/writes.test.ts`
- `apps/web/src/lib/ledger/errors.ts`
- `apps/web/src/lib/ledger/errors.test.ts`
- `apps/web/src/routes/_auth/accounts/$accountId.tsx`
- `apps/web/src/routes/_auth/audit.tsx`
- `docs/open-questions.md`
- `docs/test-coverage.md`
- `docs/product/roles-and-permissions/ledger.md`
- `docs/tasks/2026-08-18-account-deactivation.md`

## Out of scope

- **Deleting an account.** A ledger account with postings cannot be deleted without breaking invariant #8 (postings are immutable) and orphaning every transaction that references it. `active = false` is the whole vocabulary the schema has for this, deliberately.
- **Hiding inactive accounts from reads.** `accounts.list` keeps returning them with `active: false`. An account that vanishes from the list the moment it is closed makes its history unreachable, and the postings screen is exactly where someone looks after closing something.
- **`sandbox.reset` reactivating closed accounts.** Reset zeroes balances; it does not reopen what an admin closed. If that turns out to be wrong it is a reset-semantics decision, not this task's.
- **A migration.** `active boolean not null default true` already exists.
- **#20 and #30.** Still deferred by decision.

## Related docs

- `docs/open-questions.md` #8 — the row this closes
- `docs/product/roles-and-permissions/ledger.md` — the admin/viewer split; this is an admin action
- `docs/adr/0003-balance-and-concurrency.md` — the row lock the conditional update relies on
- `packages/db/src/posting/lock-accounts.ts` — where `AccountInactive` is detected, and why it is detected there

## External sources

- Task/issue: `N/A: no external tracker configured`
- Product documentation: `N/A: all product docs are local, in docs/`
- Design: `N/A: tokens in packages/ui/src/styles/globals.css are authoritative`

## Actors, entry points, preconditions

- **Actor:** an org admin. A viewer is refused by `adminProcedure` before the handler runs.
- **Entry point:** `accounts.deactivate` / `accounts.reactivate`, surfaced on the account detail screen (`/accounts/$accountId`).
- **Precondition:** the account exists in the caller's org. For deactivation, its balance is exactly zero.

## Happy path

1. `setAccountActive` in the accounts repository performs a **single conditional `UPDATE ... RETURNING`**, not a read-then-write. Deactivation carries `AND balance = 0` in the `WHERE`; Postgres takes the row lock for the update, so a concurrent `postTransaction` either commits first (and the condition then fails against the committed balance) or blocks. A check-then-update would let a posting land between the two statements and close a funded account.
2. Zero rows returned means the update did not apply. Only then does a follow-up read decide *why*: no row → `AccountNotFound`; a row with a non-zero balance → `AccountNotEmpty`. The extra read is on the error path only, and a concurrent posting racing it can at worst produce a slightly stale explanation for a call that already wrote nothing.
3. `accounts.deactivate` and `accounts.reactivate` sit on `adminProcedure` and return the updated `accountSchema`.
4. Both write an audit entry through the existing `recordSettingChange`.
5. The account detail screen gets a Close / Reopen action for admins, disabled with a reason when the balance is non-zero.

## Why this is audited when `accounts.create` is not

The audit screen currently tells the reader "Creating an account is not recorded here — only transactions and refusals are", and that caveat is correct as written. Deactivation is on the other side of the line: **it changes whether money can move**. Posting to a closed account fails, so closing one is a control change, in the same family as toggling `requireTransferApproval` — which is audited precisely because turning it off used to leave no trace (#25). Creating an empty account changes nothing about what can move. The caveat text is updated so it stays true rather than becoming a second thing that drifted.

## Error paths

- **Non-zero balance on deactivate** → `422 account_not_empty`. Nothing is written. The message names the rule, never the balance — `docs/backend/error-handling.md` forbids interpolating values, and the caller can read the balance from `accounts.get`.
- **Unknown or cross-org account id** → `404 account_not_found`, byte-identical either way, per the indistinguishability rule in `packages/db/src/errors.ts`.
- **Viewer** → `403 insufficient_role` from `adminProcedure`, before the handler runs.
- **Deactivating an already-inactive account** → succeeds and is idempotent. The end state is what was asked for, and a conflict error here would make a retried request look like a failure.
- **A pending transfer naming a closed account** → unchanged, and deliberately not pre-checked at close time. It fails at approve time with `422 account_inactive`, which is already the correct answer and is already enforced under the row lock; scanning the pending queue at close time would be a check that a concurrent submission invalidates immediately.

## Permissions

`deactivate` / `reactivate` are `adminProcedure`. Reads are unchanged: a viewer still sees inactive accounts and their history, and `session.context` already tells the console whether to render the action at all — an affordance hint, with the real refusal server-side.

## Side effects

One `active` column flip and one audit entry per successful call. No balance, posting, or transaction is written.

## Acceptance criteria

- [x] `accounts.deactivate` closes a zero-balance account; `accounts.get` then reports `active: false`.
- [x] Posting to a deactivated account returns `422 account_inactive` — asserted through the **new procedure**, replacing the raw-SQL `UPDATE ledger_account SET active = false` currently used in `writes.test.ts`. Removing that hack is a signal the gap is genuinely closed.
- [x] Deactivating an account with a non-zero balance returns `422 account_not_empty`, and the account stays active.
- [x] `accounts.reactivate` reopens it and posting works again.
- [x] A viewer is refused `403 insufficient_role` on both.
- [x] A cross-org account id returns `404 account_not_found`, not `422`.
- [x] Deactivating twice is idempotent, not a conflict.
- [x] Both actions appear in the audit log.
- [x] The audit screen's "creating an account is not recorded" caveat is updated so it is still true.
- [x] `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build` all pass.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Retention

Move to `docs/tasks/archive/2026/` on `Done`, once #8 reflects what shipped.

## Spec completeness checklist

### Common
- [x] Actor(s) defined
- [x] Entry point defined
- [x] Preconditions described
- [x] Happy path described
- [x] Error paths described
- [x] Permissions considered
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `accounts.deactivate` / `accounts.reactivate`, input `{ accountId }`, output `accountSchema`
- [x] Validation described — `accountId` as `z.uuid()` at the contract; the balance rule in the conditional `UPDATE`, not in the handler
- [x] Error responses defined — `422 account_not_empty`, `422 account_inactive`, `404 account_not_found`, `403 insufficient_role`
- [x] Side effects listed — one column flip, one audit entry

### Frontend
- [x] Loading state defined — the action button disables while the mutation is in flight, as every other write action on this screen does
- [x] Empty state defined — `N/A: no new list surface`
- [x] Error state defined — `describeFailure` entry for `account_not_empty`, surfaced by the same toast as other `422`s
- [x] Navigation after each action defined — stays on `/accounts/$accountId`; the account is still readable and its history is the reason to remain
- [x] Feedback (toast/inline/modal) defined — `sonner` toast on success and failure; no confirmation modal, because the action is reversible and a modal for a reversible change is friction without safety

---

*Started 2026-08-18.*
