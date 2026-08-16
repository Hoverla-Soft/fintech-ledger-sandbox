# Task: Enforce maker-checker on the server, and stop `approvals.approve` double-posting

## Goal

`requireTransferApproval` is a segregation-of-duties control: one admin submits a transfer, a **different** admin approves it, and money moves only on approval. The pieces exist (`ledger_pending_transfer`, `approvals.*`, `403 self_approve_forbidden`) and the self-approve guard is correct.

The control itself is not. It is applied in a React component and nowhere else, so it constrains the console rather than the ledger — and the threat maker-checker exists to address is a legitimate insider with legitimate admin credentials, which is exactly the actor who can skip the console.

Second, `approvals.approve` mints its posting from a **client-supplied** idempotency key, so approving twice posts twice. This is not a theoretical race: `apps/web/src/routes/_auth/approvals.tsx:41` calls `crypto.randomUUID()` on every click, so a double-click on Approve moves the money twice and leaves the second transaction orphaned from the pending row.

Outcome: the flag is enforced where the money moves, and one pending transfer can produce at most one transaction — enforced by the database, not by a check.

## Status

Human Review

## Scope (allowed paths)

- `packages/api/src/routers/transactions.ts`
- `packages/api/src/routers/approvals.ts`
- `packages/api/src/routers/approvals.test.ts`
- `packages/api/src/routers/writes.test.ts`
- `apps/web/src/routes/_auth/approvals.tsx`
- `apps/web/src/features/transfer/fee-split-form.tsx`
- `apps/web/src/features/transfer/transfer-form.tsx`
- `apps/web/src/lib/ledger/errors.ts`
- `apps/web/src/features/transfer/fee-split-form.test.tsx`
- `apps/web/src/features/transfer/transfer-form.test.tsx`
- `docs/backend/error-handling.md`
- `docs/product/roles-and-permissions/ledger.md`
- `docs/open-questions.md`
- `docs/showcase/security.md`
- `docs/test-coverage.md`
- `docs/tasks/2026-08-16-server-side-maker-checker.md`

Added mid-task, after the adversarial pass (see below):

- `packages/api/src/procedures.ts` — the gate moved onto the ladder as `directPostProcedure`
- `packages/api/src/routers/sandbox.ts` — `seed` / `reset` were proven bypasses
- `packages/api/src/routers/settings.ts` — disabling the control was unaudited
- `packages/api/src/contracts/idempotency.ts` — reserves the `approve:` key namespace
- `packages/db/src/repositories/audit.ts` — `recordSettingChange`, since `recordRejection` hardcodes `outcome: "rejected"`
- `packages/api/src/index.ts` — exports the new rung
- `apps/web/src/features/exchange/exchange-form.tsx` — says up front that FX is unavailable under approvals

## Out of scope

- ~~**`transactions.reverse`.**~~ **This exclusion was wrong and is retracted.** The reasoning — "a reversal mirrors a transaction that already exists, so it cannot express arbitrary value movement" — ignores that reversing a reversal is deliberately permitted. An adversarial pass drove an account 100 → 0 → 100 → 0 → 100 with four calls against a real database, no second approver. `reverse` is now gated, along with `sandbox.seed` and `sandbox.reset`, which were excluded on the same faulty reasoning and disproved the same way.
- The `ledger_pending_transfer` schema — the existing shape is sufficient.
- Open question #27 (int8 balance overflow → unaudited 500). Same file, different bug, no dependency between them.

## Related docs

- `docs/product/roles-and-permissions/ledger.md:49` — currently describes maker-checker purely as transfer-*form* behaviour, which is the documentation half of this defect
- `docs/adr/0004-idempotency.md` — the reservation semantics the `approve` fix relies on
- `docs/backend/error-handling.md` — the reason-code table a new `403` must join

## Happy path

1. **Gate the server.** `transactions.create` reads the org's `requireTransferApproval`; when on, it refuses with `403 approval_required` and records the rejection in the audit log like every other refusal. This covers both money-moving forms, because fee split posts through `transactions.create` too.
2. **Close the sibling bypass.** `transactions.exchange` also posts, and the pending table cannot represent its two-transaction shape — so with approvals on it is refused rather than left as an unguarded path to move value. **This disables FX while approvals are on**; see "Decision to confirm" below.
3. **Make the approval post idempotent per pending row.** Derive the key from `pending.id` instead of accepting one from the caller, so a second approve *replays* through the existing `UNIQUE (org_id, key)` reservation rather than posting again. The client cannot choose it, because choosing it is the bug.
4. **Stop the console guessing.** `requireApproval` read `settings.data?.requireTransferApproval === true`, so an in-flight or failed `settings.get` posted money immediately. Inverting it to `!== false` fixed that and introduced the mirror-image bug — parking money in a queue an org with approvals *off* does not watch, needing a second admin to release it. Neither guess is safe, so submit is disabled until the policy is known.
5. **Give fee split the pending path** the transfer form already has.
6. **Tests, then docs.**

## What changed after the adversarial pass

The gate shipped first as a helper each write handler called. Three handlers did not call it, and all three were proven exploitable against real Postgres — so the guard moved onto the procedure ladder as `directPostProcedure`, where a handler cannot forget it. Scope grew to `packages/api/src/procedures.ts`, `packages/api/src/routers/sandbox.ts`, `packages/api/src/routers/settings.ts`, `packages/api/src/contracts/idempotency.ts`, `packages/db/src/repositories/audit.ts`, and `apps/web/src/features/exchange/exchange-form.tsx`. Two further defects surfaced and are fixed: disabling the control left no audit trace at all, and a caller could pre-burn the server's derived key to block an approval permanently.

## Decision to confirm

Step 2 means: with `requireTransferApproval` on, `transactions.exchange` returns `403`. FX is unavailable to that org until approvals are turned off, because there is no approval route for a two-transaction exchange.

The alternative — leave `exchange` ungated — keeps FX working but leaves a documented way for an admin to move value without a second pair of eyes, which makes the whole control advisory again. Fail-closed is the correct default for a security control, so that is what ships; say the word and it becomes a recorded open question instead.

## Acceptance criteria

- [x] With the flag on, `transactions.create` returns `403 approval_required` and writes an audit rejection
- [x] With the flag off, `transactions.create` behaves exactly as before
- [x] `approvals.approve` still posts (a guard on `create` must not deadlock the approval path — approve goes through `postTransaction`, not the wire procedure)
- [x] Two concurrent approves of one pending transfer produce exactly **one** transaction
- [x] Approving twice in sequence does not post twice
- [x] `approvals.approve` no longer accepts an `idempotencyKey`
- [x] The console neither posts nor queues while the approval policy is unknown — submit is disabled until `settings.get` resolves
- [x] Fee split routes through the approval queue when the flag is on
- [x] `approval_required` is in the reason table and the console's reason registry

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

Move to `docs/tasks/archive/2026/` at `Done`. Durable decisions land in `docs/open-questions.md` (#24-#26), `docs/backend/error-handling.md`, and `docs/product/roles-and-permissions/ledger.md` first.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — an org `admin`; the submitter and the approver must be different users. A `viewer` is already refused upstream by `adminProcedure`
- [x] Entry point defined — `transactions.create`, `transactions.exchange`, `approvals.approve` on the API; Transfer, Fee split, and Approvals screens in the console
- [x] Preconditions described — org has `requireTransferApproval` on; a pending row exists and is `status = "pending"`; the approver is not its `createdBy`
- [x] Error paths described — `403 approval_required` (flag on, direct post attempted), `403 self_approve_forbidden` (unchanged), `409 pending_already_decided` (lost the race — money did not move twice), `404 pending_not_found`
- [x] Permissions considered — `docs/product/roles-and-permissions/ledger.md`; this task also corrects that file, which describes the control as form behaviour
- [x] Acceptance criteria written
- [x] Tests defined — flag-on refusal + audit row, flag-off unchanged, approve-still-posts, concurrent double-approve yields one transaction, console fail-closed
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — no new procedure; `transactions.create`/`exchange` gain a refusal, `approvals.approve` loses an input field
- [x] Validation described — the gate is an authorization check after the role check, not input validation; it reads org state, so it cannot live in a Zod schema
- [x] Error responses defined — `403` with `data.reason = "approval_required"`, message naming no account or amount, per the "errors leak nothing" rule
- [x] Side effects listed — one extra settings read per write when the flag is off; an audit rejection row when it is on; `approve` now reserves a key derived from `pending.id`

### Frontend
- [x] Loading state defined — while `settings.get` is in flight the submit path is treated as approval-required (fail closed) rather than optimistically posting
- [x] Empty state defined — `N/A: no new list surface`
- [x] Error state defined — `approval_required` renders through the existing `describeFailure` registry, inline on the form
- [x] Navigation after each action defined — unchanged: posted → transaction detail; pending → Approvals queue
- [x] Feedback (toast/inline/modal) defined — unchanged toasts for posted vs pending; fee split gains the pending toast the transfer form already has

---

*Started 2026-08-16. Follows `2026-08-16-api-hardening-phase`. Both #25 and #26 are in one task deliberately: they are the same file, the same money path, and the fix for #26 is what makes the approval route safe enough to force everyone onto in #25.*
