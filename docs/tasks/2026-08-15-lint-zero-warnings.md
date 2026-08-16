# Task: Lint gate to zero diagnostics

## Goal

`pnpm lint` reports nothing at all — no errors (already true), no warnings, no infos, no deprecation notice. Every fix must preserve behavior: no rule disabled repo-wide, no check weakened to get there; where a diagnostic marks *deliberate* code (e.g. an `any` used to probe a contract negatively), the resolution is a properly-typed alternative or a targeted, reasoned suppression on that line — never a config-level off-switch.

## Status

Human Review

## Scope (allowed paths)

- `.claude/scripts/glob-match.js`
- `.claude/scripts/guard-router.js`
- `.claude/scripts/migration-integrity-guard.js`
- `.claude/scripts/scope-guard.js`
- `apps/web/src/components/states/index.tsx`
- `packages/api/src/routers/approvals.test.ts`
- `packages/api/src/routers/dashboard.test.ts`
- `packages/api/src/routers/no-org-input.test.ts`
- `packages/api/src/routers/reads.test.ts`
- `packages/api/src/routers/sandbox.test.ts`
- `packages/api/src/routers/writes.test.ts`
- `packages/api/src/sandbox/reset-plan.test.ts`
- `packages/env/src/web.ts`
- `scripts/bench/run.mjs`
- `turbo.json`
- `biome.jsonc`
- `docs/tasks/2026-08-15-lint-zero-warnings.md`

## Out of scope

- Changing which rules are enabled (severity downgrades, rule `"off"` entries, new ignore globs) — the existing `packages/ui` a11y override stays exactly as is
- Any behavioral change to the guard scripts — they are enforcement infrastructure; after edits, each must be smoke-tested
- The Base UI `nativeButton` console warnings (runtime, not lint — separate concern)

## Related docs

- `docs/development/tech-stack.md` → Linter row (Biome 2.5.6, `recommended` baseline, "every deviation carries a written reason")
- CLAUDE.md → "Never make CI green by weakening a check"

## External sources

- Task/issue: N/A: follow-up to this session's lint-error fix, no external tracker entry
- Product documentation: N/A: all sources local
- Design: N/A: no UI change

## Acceptance criteria

- `pnpm exec biome check .` exits clean with **zero** errors, warnings, and infos, and no deprecation notice.
- The `biome.jsonc` migration off the deprecated `recommended` field provably enables the same rule set: the full diagnostic list on unfixed code is identical before and after the config change.
- Guard scripts still work after their edits: `migration-integrity-guard.js --check` passes, and `scope-guard.js` still blocks an out-of-scope path and allows an in-scope one in a smoke test.
- Full suite green: `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

## Retention

Move to `docs/tasks/archive/2026/` when Done.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — maintainer running the lint gate locally and in CI
- [x] Entry point defined — `pnpm lint`
- [x] Preconditions described — repo at current HEAD with 32 known warning/info diagnostics
- [x] Happy path described — mechanical fixes where safe, typed alternatives where `any` is removable, reasoned line-level suppressions where the code is deliberate, config migrated without coverage change
- [x] Error paths described — if a fix breaks typecheck/tests or changes guard behavior, revert that fix and use a reasoned line-level suppression instead
- [x] Permissions considered — N/A: no runtime auth surface touched
- [x] Acceptance criteria written
- [x] Tests defined — existing suites are the regression net; guard scripts get explicit smoke tests; config migration verified by diagnostic-list diff
- [x] Out of scope stated explicitly

### Backend
- [ ] API endpoints defined — N/A: test files and env typing only, no endpoint changes
- [ ] Validation described — N/A: no schema changes
- [ ] Error responses defined — N/A: no contract changes
- [ ] Side effects listed — N/A: no runtime behavior change intended anywhere

### Frontend
- [ ] Loading state defined — N/A: one mechanical optional-chain fix, no state changes
- [ ] Empty state defined — N/A: as above
- [ ] Error state defined — N/A: as above
- [ ] Navigation after each action defined — N/A: no UI behavior change
- [ ] Feedback (toast/inline/modal) defined — N/A: no UI behavior change

---

*Started 2026-08-15.*
