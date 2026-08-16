# Task: Close recorded gaps found by the 2026-08-16 gap audit

## Goal

`docs/open-questions.md` is the file CLAUDE.md tells every session to read first, and it had drifted far enough to mislead: rows describing limitations that were silently fixed weeks ago, a row asserting CI was "Resolved" when CI has never executed a single check, and a row calling a live security hole a shipped feature.

The outcome wanted here is a registry that tells the truth, plus the subset of gaps that are cheap, provable, and safe to close in one pass. Behavioural changes on the money path are deliberately **recorded and not made** — they are listed under "Deferred" and need an explicit decision.

## Status

Human Review

## Scope (allowed paths)

- `docs/open-questions.md`
- `docs/development/work-systems.md`
- `docs/tasks/2026-08-16-close-recorded-gaps.md`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `apps/web/vitest.config.ts`
- `docs/development/tech-stack.md` — **added mid-task, deliberately.** `configuration-guard`'s inheritance/drift check surfaced two rows that contradict the very files this task edits: it named the Biome config `biome.json` (it is `biome.jsonc`, and the difference is load-bearing) and claimed CI runs Postgres as a service container, which is the exact opposite of what `ci.yml` says and explains why. CLAUDE.md calls this file "the source of truth every skill/agent reads instead of assuming", so a wrong row here misleads every future session. Corrections only; no stack decision changed

## Out of scope

- **`packages/api`, `packages/db`, `apps/server`, `apps/web/src`** — every remaining finding in those trees changes behaviour on a money path or an API contract. Recorded as open questions #25–#29 instead. Do not "fix while you're in there."
- `packages/ui` — vendoring `shadcn/tailwind.css` to drop the CLI from production dependencies is the right call, but it is a separate change with its own visual-regression risk.
- Archiving the six task files sitting at `Human Review`. `Human Review` means *awaiting maintainer sign-off*, not *complete*; archiving them is the maintainer's call, not this task's.
- GitHub branch protection and billing (#10, #17) — repository/account settings, not files.

## Related docs

- `docs/open-questions.md` — the registry this task repairs
- `docs/development/infrastructure.md` — repeats the "nothing is deployed" claim corrected in #18
- `CLAUDE.md` → "How work gets done here"
- `docs/product/roles-and-permissions/ledger.md` — defines the admin/viewer split and the `self_approve_forbidden` rule that deferred finding #25 concerns. Line 49 describes maker-checker purely as transfer-*form* behaviour, which is exactly why the server-side hole went unnoticed; correcting it belongs with the #25 fix, not here

## External sources

- Task/issue: `N/A: no external tracker configured` — see `docs/development/work-systems.md`, now filled
- Product documentation: `N/A: all product docs are local, in docs/`
- Design: `N/A: no external design source; tokens in packages/ui/src/styles/globals.css are authoritative`

## Happy path

The order matters and is not arbitrary — step 2 must precede step 3, or CI goes red on the first push:

1. **Measure before editing.** Run the full suite to record a green baseline, and run `pnpm audit` (never run in this repo before) to find out what is actually outstanding rather than what #18 guessed.
2. **Fix the advisories.** Raise the `hono` catalog floor to the patched version; add bounded `overrides` for `nanoid` and `brace-expansion`. Re-install, then confirm the resolved versions are *patch* bumps — an unbounded range resolves to a major and silently swaps the package.
3. **Add the gate that would have caught them.** `pnpm audit --audit-level=high` in `ci.yml` plus `.github/dependabot.yml`. Only now, because a gate added at step 2 fails immediately.
4. **Ratchet lint.** Switch `pnpm lint` to `--error-on-warnings` so the zero-diagnostic state is enforced rather than coincidental.
5. **Remove the flake's cause.** Set `testTimeout` from the measured isolated-vs-contended spread, not from a guess, and not with `retry`.
6. **Repair the registry.** Rewrite every row that no longer matches reality, and open new rows for what the audit found and this task is *not* fixing.
7. **Re-run the full suite** including the new audit step.

## Acceptance criteria

- [x] `pnpm lint` fails on Biome warnings, not only errors, and passes at zero diagnostics today
- [x] `pnpm audit --audit-level=high` reports **0 high** (was 3) and runs in CI
- [x] Dependabot configured for npm + github-actions, grouped, majors excluded
- [x] `apps/web` suite has a `testTimeout` justified by measurement, and **no** retries
- [x] Registry rows #10, #12, #15, #16, #18, #19, #24 match reality; #12b and #25–#29 opened for what is still broken
- [x] `docs/development/work-systems.md` contains no `{{placeholder}}`
- [x] Full verification suite green

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
pnpm audit --audit-level=high
```

Result 2026-08-16 — all six green: lint (257 files, 0 diagnostics, now `--error-on-warnings`) · check-types (6/6) · test (**715 passed**: core 90, web 294, db 28, api 303) · build (2/2) · migration guard · audit (0 high, was 3).

Baseline before the task was identical except `pnpm audit`, which exited non-zero with 3 high.

## Deferred — recorded, not fixed

Opened as `docs/open-questions.md` #25–#29. Each changes behaviour on a money path:

- **#25** maker-checker enforced browser-only — `transactions.create` never reads `requireTransferApproval`; fee-split ignores it entirely; the transfer form fails *open* on a failed `settings.get`
- **#26** `approvals.approve` can double-post (read-check-post-then-mark, client-minted idempotency key)
- **#27** per-amount bound is not a per-balance bound — int8 overflow surfaces as an unaudited 500
- **#28** no SIGTERM handler, DB-blind health check, no statement/connection timeout or pool bound, no body size limit
- **#29** `approvals.listPending` truncates at 100 with no cursor

## Retention

Move to `docs/tasks/archive/2026/` when this reaches `Done`. The durable decisions are already written into `docs/open-questions.md` (#10, #12, #15, #16, #18, #19, #24–#29) and `docs/development/work-systems.md`, so archiving loses nothing.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — maintainer running the repo's own checks; no end-user actor, this is repo hygiene
- [x] Entry point defined — `pnpm lint` / `pnpm audit` / CI, plus `docs/open-questions.md` as the read-first registry
- [x] Preconditions described — green baseline recorded under Verification before any edit
- [x] Happy path described — "Happy path" section, seven ordered steps; the 2-before-3 dependency is stated because reversing it turns CI red
- [x] Error paths described — `N/A: no runtime code paths changed`; the one failure mode (an override resolving to a major) is recorded in #18
- [x] Permissions considered — `N/A: no authorization surface touched`. The authorization gap found *is* #25, deliberately deferred
- [x] Acceptance criteria written
- [x] Tests defined — no new tests; `testTimeout` is a config change pinned by the existing 294-test web suite. Test gaps found by the audit (`accounts.postings` uncovered, no cross-org approvals test) are recorded, not closed here
- [x] Out of scope stated explicitly

### Backend
- [x] API endpoints defined — `N/A: no endpoint added or changed`
- [x] Validation described — `N/A: no wire input touched`
- [x] Error responses defined — `N/A`. The new `403 approval_required` that #25 would need is explicitly *not* part of this task
- [x] Side effects listed — dependency resolution changes only: `hono` 4.12.32→4.13.2, `nanoid`→3.3.18, `brace-expansion`→2.1.4. Build and all 715 tests pass on the new tree

### Frontend
- [x] Loading state defined — `N/A: no UI changed`
- [x] Empty state defined — `N/A: no UI changed`
- [x] Error state defined — `N/A: no UI changed`
- [x] Navigation after each action defined — `N/A: no UI changed`
- [x] Feedback (toast/inline/modal) defined — `N/A: no UI changed`

---

*Started 2026-08-16. Scope was held deliberately: the audit surfaced 56 verified findings and this task closes only the ones that change no behaviour. Everything else is written into the registry so the next session starts from the truth rather than rediscovering it.*
