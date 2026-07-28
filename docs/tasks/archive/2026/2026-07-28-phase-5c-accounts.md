# Task: Phase 5c — accounts: list, detail, create

## Goal

Ship the accounts screen, and in doing so prove the whole write pipeline — admin gating, `409`/`422`/`429` handling, dialog-closes-only-after-resolve, invalidate-after-mutation — on the **cheapest write in the API**, before 5d uses that same pipeline to move money.

`accounts.create` is the right place to prove it: it takes **no idempotency key** and writes **no audit entry** (`docs/adr/0006-write-endpoint-contract.md`), and its worst failure is a duplicate name. Every mistake made here is recoverable. The same mistakes made first in `transactions.create` are a double-posted payroll.

## Status

Done

Approved at human review 2026-07-28; Phase 5d started immediately after.

## Scope (allowed paths)

**`apps/web` — the screen:**

- `apps/web/src/routes/_auth/accounts/**`
- `apps/web/src/features/accounts/**`
- `apps/web/src/components/shell/**`
- `apps/web/src/routeTree.gen.ts`

**Shared UI (just-in-time primitives only):**

- `packages/ui/src/components/table.tsx`
- `packages/ui/src/components/badge.tsx`
- `packages/ui/src/components/dialog.tsx`
- `packages/ui/src/components/select.tsx`
- `packages/ui/src/components/field.tsx`

**Documentation:**

- `docs/frontend/forms-and-validation.md`
- `docs/test-coverage.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-5c-accounts.md`

## Out of scope

- **Transfers, transactions, reconciliation, sandbox, audit.** 5d–5g.
- **`apps/web/src/lib/ledger/**`** — 5a's kernel is closed. The money formatter is consumed, not edited.
- **`apps/web/src/lib/org/**`, the guard, the query client** — 5b's, and settled.
- **An `accounts.deactivate` action.** No such procedure exists (open question #8); the console offers no close action rather than inventing one.
- **Pagination or filtering of the account list.** `accounts.list` returns every account unpaginated (open question #7). Tolerated at sandbox scale.

## Related docs

- `docs/adr/0002-money-representation.md`
- `docs/adr/0006-write-endpoint-contract.md`
- `docs/adr/0007-rate-limiting.md`
- `docs/frontend/ui-states.md`
- `docs/product/roles-and-permissions/ledger.md`

## External sources

- Task/issue: N/A: local phase task, no external tracker configured.
- Product documentation: `docs/product/requirements/ledger.md` (local, authoritative).
- Design: N/A.

## Approved decisions

**D1 — balances are rendered from the wire string, not re-derived.** `accountSchema.balance` is a `moneySchema` whose `amount` has already been formatted by `Money.format()` at the currency's own exponent (`packages/api/src/contracts/wire.ts`). The console renders that string directly. Re-parsing it into minor units and re-formatting would introduce a second formatting path that could disagree with the server's for no benefit. 5a's `formatMinorUnits` stays for the composition path, where the console genuinely holds `bigint`s of its own.

**D2 — a negative balance is rendered plainly, not as an error.** `external` accounts are *expected* to go negative — that is what makes them the boundary money enters the sandbox through (`docs/product/requirements/ledger.md`). The UI distinguishes the two account types visibly so a negative external balance reads as normal, while a negative `normal` balance — which invariant #6 makes impossible — would stand out.

**D3 — the create dialog closes only after the request resolves, and never on a validation failure.** `ledger.md:76` requires it. The specific trap: `account_name_taken` is a `409` the user can fix by typing a different name, so the dialog must stay open with the field populated and the reason inline. Closing on submit and toasting the error would discard what they typed.

**D4 — the create button is hidden from viewers, and the `403` branch is implemented anyway.** `docs/product/roles-and-permissions/ledger.md` — *"'The frontend hides the button' is not enforcement anywhere in this system."* The role is derived client-side from a session Better Auth may have cached (ADR 0009) and can be revoked mid-session, so a viewer *can* reach the mutation. The handler treats `insufficient_role` as a real branch, not a defensive comment.

## Design

### Screens

| Route | Contents |
|---|---|
| `/accounts` | Table: name, type badge, currency, balance, status. Skeleton → table, empty state with a create action, error state with retry. |
| `/accounts/$accountId` | One account's detail and balance. A `404` says "not found in this organization" and never "no access" — the API returns byte-identical `404`s for a missing id and a cross-org id on purpose (`accounts.ts:58-63`). |

### The create dialog's failure branches

Every one of these is reachable and each is handled distinctly:

| Failure | Status | Where it renders |
|---|---|---|
| `account_name_taken` | 409 | Inline on the **name** field; dialog stays open |
| `unsupported_currency` | 422 | Inline on the **currency** field |
| `insufficient_role` | 403 | Dialog closes, toast — the form cannot fix this |
| `rate_limited` | 429 | Inline, with `retryAfterSeconds` from the body; dialog stays open |
| Zod `issues` | 400 | Mapped to their fields |

The currency picker is populated from `CURRENCIES` (`@fintech-ledger-sandbox/api/contracts/currencies`, added 5a), so `unsupported_currency` is unreachable through the UI — but the branch is wired anyway, because the wire schema is `z.string()` and a stale client is possible.

### Sandbox suspense accounts

`sandbox.reset` may auto-create `Sandbox Suspense <CUR>` external accounts (`docs/adr/0008-sandbox-reset.md`). They are real accounts and appear in the list. The screen labels them rather than hiding them — hiding rows from a ledger view is exactly the kind of thing this product must not do.

## Acceptance criteria

- The list renders name, type, currency, balance, and active status; balances show at the currency's own scale (a JPY account reads `0`, a USD account `0.00`).
- Skeleton while pending; empty state with a create action; error state distinct from empty with a working retry — all three via `QueryState`, so error-before-empty precedence holds.
- Detail renders one account; a `404` reads as "not found in this organization" and never implies another tenant.
- Create: name (1–120) and currency constrained client-side to the allowlist; type is `normal` or `external`.
- `account_name_taken` renders **inline on the name field with the dialog still open** and no success toast.
- Submit is disabled for the whole in-flight window; the dialog closes only after the request resolves.
- `accounts.list` is invalidated after a successful create, then the user lands on the new account's detail.
- The create button is absent for a viewer, **and** a forced mutation still renders `insufficient_role` correctly.
- `429` surfaces `scope`, `limit`, and `retryAfterSeconds` from the response body.
- An accounts nav link exists in the shell, so the screen is reachable by clicking.
- `docs/frontend/forms-and-validation.md` is filled and no longer a `{{...}}` template.

## Verification

```bash
pnpm lint        # N/A: no linter is wired in this repo yet (Biome/oxlint planned)
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5b: `check-types` 6/6, `test` 459 passed (73 core + 126 web + 28 db + 232 api), `build` 2/2, guard PASS.

**Result, verified 2026-07-28:** `check-types` **6/6 green** · `build` **2/2 green** · `test` **473 passed** (73 core + **140 web** + 28 db + 232 api) · migration guard **PASS**. `pnpm lint` — `N/A`. Backend suites untouched; the +14 are all `apps/web` (6 account display, 8 field-error routing).

**Manual demo** (requires `pnpm db:start` and `pnpm dev`):
1. Create `Operating` in USD → land on its detail showing `0.00 USD`.
2. Create `Operating` in USD again → `409` inline on the name field, dialog still open, no success toast.
3. Create an account in JPY → its balance reads `0`, not `0.00`.
4. Sign in as a viewer → no create button; the list still renders.

## Retention

When this reaches `Done`, move it to `docs/tasks/archive/2026/` and **delete `.claude/.active-task-scope.json`**.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — org admin (creates), org viewer (reads only).
- [x] Entry point defined — `/accounts` via the shell nav; `/accounts/$accountId` from a row.
- [x] Preconditions described — a signed-in user with a verified active organization (5b's guard).
- [x] Happy path described — list → create dialog → resolve → invalidate → detail.
- [x] Error paths described — the five-branch table above, plus load failures.
- [x] Permissions considered — D4; button hidden for viewers, `403` branch implemented regardless.
- [x] Acceptance criteria written
- [x] Tests defined
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: no procedure is added or changed. Consumes `accounts.list`, `accounts.get`, `accounts.create` exactly as published.
- [x] Validation described — the console mirrors the published input contract (name 1–120, currency from the allowlist, type enum) rather than restating it loosely; the server remains the arbiter.
- [x] Error responses defined — the branch table; all consumed through 5a's `describeFailure`.
- [x] Side effects listed — one row in `ledger_account`. No audit entry and no idempotency key: `accounts.create` writes neither (`ADR 0006`).

### Frontend
- [x] Loading state defined — skeleton table via `QueryState`.
- [x] Empty state defined — "no accounts yet" with a create action.
- [x] Error state defined — distinct from empty, with retry.
- [x] Navigation after each action defined — create → detail; cancel → list unchanged; row click → detail.
- [x] Feedback defined — toast on success; inline field errors for `409`/`422`/`400`; toast for `403`.

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it.*

*Phase 5 slice 3 of 8. Predecessors: 5a (kernel, Done), 5b (tenant gate, Done). Successors: 5d transfer · 5e history + reversal · 5f reconciliation + sandbox · 5g audit · 5h retire `privateData`.*
