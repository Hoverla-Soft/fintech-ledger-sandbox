# Task: Phase 2 — Ledger domain core (packages/core)

Run with `/feature-loop docs/tasks/2026-07-27-phase-2-domain-core.md` (or `/work-task …`) from a session rooted in this repo. The **Scope** section is enforced by the `PreToolUse` scope-guard hook.

## Goal

A pure, zero-infrastructure domain in `packages/core` that makes the ledger's illegal states unrepresentable and is unit-tested with no database. It is consumed later by `packages/api` (Phase 4) and its rules are applied under lock by `packages/db` (Phase 3). No HTTP, no Drizzle, no React — `packages/core` imports nothing from sibling packages.

Deliver:
- **`Money`** value object — integer minor units stored as `bigint`, an ISO-4217 `currency`, safe `add`/`subtract`/`negate`/`compare`/`isZero`/`isNegative`, and decimal string parse/format for display. No floats anywhere. Arithmetic across mismatched currencies is rejected (typed error), never silently coerced.
- **Account model** — `id`, `orgId`, `currency`, `type` (`normal` | `external`) and the pure funds rule: a `normal` account's resulting balance may never be negative; an `external` account may. Expose `applyDelta(account, balance, delta): Result<Money, InsufficientFunds>`.
- **Posting** — `accountId`, `direction` (`debit` | `credit`), positive `Money` amount.
- **Transaction** — a smart factory that constructs only from ≥2 postings that (a) net to zero, (b) share one currency, (c) all have positive amounts. Construction fails (typed `Result`/error) otherwise — there is no way to hold an unbalanced `Transaction`. Exposes the net signed delta per account.
- **Reversal** — given a `Transaction`, produce its mirror (swap every posting's direction); balance and currency properties preserved by construction.
- **Test runner setup** — Vitest wired at the root + `packages/core`, a `test` turbo task and root `test` script, so `pnpm test` runs the core suite.
- **ADR 0002** — money representation (integer minor units), with the reasoning.

## Status

Ready

## Scope (allowed paths)

- `packages/core/src/**`
- `packages/core/vitest.config.ts`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `vitest.config.ts`
- `vitest.workspace.ts`
- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `docs/test-coverage.md`
- `docs/adr/0002-money-representation.md`
- `docs/adr/README.md`

## Out of scope

- No `packages/db` schema, repositories, or SQL — the domain must not know persistence (Phase 3). The funds rule is a *pure function*; reading/locking the real balance is Phase 3's job.
- No `packages/api`, `apps/server`, or `apps/web` changes (Phases 4–5).
- No holds/authorizations or FX — out of v1 per `docs/product/requirements/ledger.md`.
- Don't "improve" unrelated scaffold files while in here.

## Related docs

- `docs/product/requirements/ledger.md` — the ledger spec + invariants this encodes
- `docs/development/architecture.md#package-boundaries` — why `packages/core` depends on nothing
- `docs/development/tech-stack.md` — Vitest is the chosen unit test runner
- `docs/adr/0002-money-representation.md` — decision record produced by this task

## External sources

- Task/issue: N/A: internal showcase, tracked in this repo's task files.
- Product documentation: `docs/product/requirements/ledger.md` (local).
- Design: N/A: no UI in this phase.

## Acceptance criteria

- `Money` never uses `number` for amounts; a float or NaN input is rejected. `1/3`-type rounding is impossible because amounts are integer minor units.
- Mismatched-currency `Money.add`/`subtract` returns/raises a typed `CurrencyMismatch`, never a wrong number.
- A `Transaction` cannot be constructed unbalanced, single-legged, mixed-currency, or with a non-positive amount — proven by tests asserting each failure mode.
- `reverse(txn)` yields a balanced transaction whose per-account deltas are the exact negation of the original.
- The `normal`-account funds rule rejects a delta that would drive the balance below zero; `external` accounts accept it.
- `pnpm test` runs the core suite green; coverage includes every invariant (money conserved, currency match, positivity, min-legs, reversal correctness, funds rule) — recorded in `docs/test-coverage.md`.
- `pnpm check-types` and `pnpm build` stay green.

## Verification

```bash
# Lint: N/A: no linter wired yet (Biome/oxlint planned) — see docs/development/tech-stack.md
pnpm check-types
pnpm test
pnpm build
```

If a check fails, fix only `packages/core` (and its test/config in Scope), rerun that check, then rerun the whole block before marking done.

## Retention

On `Done`, move to `docs/tasks/archive/2026/`. Before archiving, confirm the money-representation decision is in ADR 0002 and the invariant coverage is in `docs/test-coverage.md`.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — N/A at domain layer (no external actor); consumers are `packages/api`/`packages/db`. Business actors are in `docs/product/requirements/ledger.md`.
- [x] Entry point defined — the public exports of `@fintech-ledger-sandbox/core` (`Money`, `Account` rules, `Transaction`, `reverse`).
- [x] Preconditions described — inputs are validated at construction; no external state.
- [x] Happy path described — construct `Money` → build balanced `Transaction` → derive per-account deltas / reverse.
- [x] Error paths described — `CurrencyMismatch`, `UnbalancedTransaction`, `NonPositiveAmount`, `TooFewPostings`, `InsufficientFunds` (all typed).
- [x] Permissions considered — N/A: pure domain, no auth surface (enforced in Phase 4).
- [x] Acceptance criteria written
- [x] Tests defined — one suite per value object + one per invariant.
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — N/A: this phase adds no HTTP surface (Phase 4).
- [x] Validation described — invariant checks live in the domain constructors/factories.
- [x] Error responses defined — typed domain errors (mapped to HTTP in Phase 4).
- [x] Side effects listed — N/A: pure, no side effects (that's the point).

### Frontend
- [x] Loading state defined — N/A: no UI this phase.
- [x] Empty state defined — N/A: no UI this phase.
- [x] Error state defined — N/A: no UI this phase.
- [x] Navigation after each action defined — N/A: no UI this phase.
- [x] Feedback defined — N/A: no UI this phase.

---

*Started 2026-07-27. If scope needs to expand mid-task, stop and update this section explicitly — the hook will block edits outside Scope either way.*
