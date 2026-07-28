# Task: Phase 6a — make the checks real

## Goal

Every command in a task file's Verification block actually checks something, and runs without a human.

Today one of the five is a documented fiction (`pnpm lint`), none of them run on push, and one workspace opts out of the shared TypeScript strictness the other seven share. This slice closes all three. It ships no product behaviour — it is the slice that makes 6b's and 6c's verification mean something.

Closes open questions **#10** (no CI), **#11** (`pnpm lint` documented but does not exist), **#14** (`apps/web` does not extend `tsconfig.base.json`).

## Status

Done

Human review waived by the user for Phase 6 (carried forward from Phase 5, reconfirmed 2026-07-28).

## Scope (allowed paths)

Configuration and CI:

- `biome.jsonc`
- `package.json`
- `pnpm-workspace.yaml`
- `apps/*/package.json`
- `packages/*/package.json`
- `apps/web/tsconfig.json`
- `.github/workflows/**`
- `.git-blame-ignore-revs`

The repo-wide format sweep (see D3) is executed by `biome format --write` through Bash, not by hand edits, so it does not pass through the scope-guard hook. These two entries cover **mechanical** hand-fixes only — a lint violation the formatter cannot auto-fix but whose correction provably cannot change runtime behaviour (import ordering, `import type` conversions, unused-import removal, `let`→`const`, template-literal preference):

- `apps/**`
- `packages/**`
- `.claude/**`

`.claude/**` was added mid-task, not planned: D4a establishes that `.claude/scripts/*.js` must be linted (they enforce this repo's rules and no per-package fan-out would reach them), and linting them means formatting them. The sweep's changes there are trailing commas and line wrapping in four `.js` files plus one blank line in `settings.json` — no behaviour. `.claude/guard-routes.json` is excluded from the *formatter* in `biome.jsonc`: it is a hand-formatted one-entry-per-line lookup table, and wrapping it at 100 columns tripled its length for no benefit.

The dividing line, and it is not a judgement call: if a fix changes what the program *does* for any input, it is out of scope for 6a regardless of which rule flagged it. See "Out of scope".

Documentation that must stay synchronized:

- `CLAUDE.md`
- `docs/development/tech-stack.md`
- `docs/development/infrastructure.md`
- `docs/development/coding-rules.md`
- `docs/open-questions.md`
- `docs/tasks/2026-07-28-phase-6a-real-checks.md`

## Out of scope

- **Any behaviour-changing fix, including one the linter is right about.** No procedure, screen, schema, or migration changes here. Biome's `recommended` set includes correctness rules (`noDoubleEquals`, `useExhaustiveDependencies`, `noArrayIndexKey`) that can flag genuine defects. When one does, it is written up as a finding and fixed in its own task with its own tests — never folded into a formatting commit, where a behavioural change would be invisible among thousands of whitespace lines. Phase 5g's `actionLabel` prototype-poisoning bug is the precedent: it needed a test to prove it, which a formatting commit has no room for.
- **Playwright / e2e.** That is 6c. CI here runs the existing five commands only; the workflow is written so adding an e2e job later is additive.
- **`packages/ui` dead scaffolding (#13, #15).** The formatter will reformat those files like any others, but the unused chat-UI components and the phantom utility classes stay. Deleting them is a separate decision that open question #13 explicitly says needs one.
- **Weakening any existing check.** `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` and the rest stay exactly as strict as they are.

## Related docs

- `docs/development/tech-stack.md` — declares the toolchain; Biome must be recorded there before installation.
- `docs/development/infrastructure.md` — owns CI/CD.
- `docs/development/coding-rules.md` — conventions the linter now enforces mechanically.
- `docs/adr/0001-internal-package-src-exports.md` — why workspace packages export TypeScript source; the CI build must respect it.

## External sources

- Task/issue: `N/A: local phase task, no external tracker configured` (`docs/development/work-systems.md` is an unfilled template — open question #12).
- Product documentation: `N/A: this slice ships no product behaviour.`
- Design: `N/A`.

## Approved decisions

**D1 — Biome, not oxlint.** Approved by the user 2026-07-28. The repo has **no formatter at all** and no linter: `find` for `.prettierrc*`/`eslint.config.*`/`biome.json` returns nothing, and no workspace package defines a `lint` script. Biome closes both gaps with one dependency and one config file; oxlint is a linter only and would leave the formatting gap open or require Prettier alongside it. Recorded in `docs/development/tech-stack.md` before installing, per CLAUDE.md.

**D2 — a `lint` script that resolves to nothing is worse than no script.** `turbo.json` already declares a `lint` task, and root `package.json` has no `lint` script. Adding only `"lint": "turbo run lint"` at the root would have made `pnpm lint` **exit 0 while checking zero files** — a green check that checks nothing, which is precisely the "guarding the guard" failure `no-org-input.test.ts` was written to prevent in Phase 5h. Therefore: every workspace package gets a real `lint` script, and the acceptance criteria below require proving the linter visited a non-zero file count rather than merely exiting 0.

**D3 — the format sweep is its own commit.** Biome formats, and nothing has ever formatted this repo, so the first `biome format --write` will touch nearly every source file. It lands as a single mechanical commit containing no logic change, and its SHA is recorded in `.git-blame-ignore-revs` so `git blame` stays useful. Config and CI land in separate commits either side of it.

**D3a — the config file is `biome.jsonc`, not `biome.json`, and that is load-bearing.** D4 requires a written reason beside every disabled rule, which requires comments. Measured 2026-07-28: `biome.json` **does not support comments and does not say so** — it silently degrades instead of erroring. A commented `biome.json` checked **551 files** (linting `apps/web/dist` and `apps/server/dist`, producing 4,706 spurious errors); the byte-identical comment-free config checked **221**. Biome exited non-zero either way, so the failure looked like "the linter found problems", not "the linter ignored your config". This is D2's hazard inverted — a check that appears to be working harder than it is — and it is exactly why the acceptance criteria pin a **file count**, not just an exit code.

**D4 — start from Biome's `recommended` rules; every deviation is written down.** Any rule turned off gets a one-line reason in `biome.json` next to it. Narrowing the ruleset until it passes would reproduce exactly the problem this slice exists to fix, and CLAUDE.md forbids making a check green by weakening it. If `recommended` surfaces violations that are real defects, they are reported as findings, not silently reformatted away.

**D4a — one root-level Biome pass, not a Turborepo fan-out — and this reverses what this task originally specified.** The draft said "every workspace package defines a `lint` script; `turbo run lint` fans out to all 8". Two things were wrong with it. There are **9** workspaces, not 8. More importantly, a per-package fan-out structurally cannot see files that belong to no package — measured, that includes **`.claude/scripts/*.js`**: `scope-guard.js`, `migration-integrity-guard.js`, `guard-router.js`, `glob-match.js`. Those four scripts *are* the machinery enforcing this repo's rules, and a fan-out design would have left the enforcement layer as the one unlinted corner of the codebase.

Biome is a single monorepo-aware binary — `biome check .` covers all 219 files in ~100ms, which is faster than invoking it nine times over overlapping trees anyway. So `pnpm lint` runs it once from the root. The `lint` task stays in `turbo.json` (harmless, and keeps the pipeline definition intact for a future per-package need) but is no longer the path `pnpm lint` takes.

**D5 — `apps/web` extends `tsconfig.base.json`; the deferral reason on record is wrong and gets corrected.** Open question #14 deferred `noUncheckedIndexedAccess` to the end of Phase 5 on the grounds that "cursor stacks, posting arrays, and paginated lists all index", implying a wide diff. Measured 2026-07-28: enabling it across `apps/web` produces **0 errors over 67 source files**, and the full `extends` form (with `lib`, `types`, `jsx`, `rootDirs`, `paths` overridden) also produces **0 errors**. The probe was confirmed live by planting `const b: string = a[0]` and observing `TS2322`. `apps/web` is the only one of eight workspaces not extending the shared base. So this is a config change with no code churn, and #14's stated reason is retired rather than left on the record as if it had been true.

**D6 — CI needs a Docker *daemon*, not a Postgres service container — correcting this task's own draft.** The draft specified `services: postgres:`. That is wrong, and shipping it would have added a container that nothing connects to. `packages/db/src/test/setup.ts` uses `PostgreSqlContainer` from `@testcontainers/postgresql`, which **starts and migrates its own `postgres:18` container** per suite. What the 260 db/api tests require is therefore a reachable Docker daemon, which `ubuntu-latest` provides natively. The workflow asserts `docker info` succeeds before running anything, so an absent daemon fails loudly instead of letting those suites be skipped — which would be D2's failure mode wearing a different hat.

**D7 — CI sets throwaway env values explicitly rather than using `SKIP_ENV_VALIDATION`.** `apps/server/.env` and `apps/web/.env` are gitignored, so a CI checkout has neither, and `packages/env` validates at import time with Zod (`BETTER_AUTH_SECRET` min 32 chars, three URLs, `DATABASE_URL`). Verified locally that `pnpm build` only passes because those untracked files exist. `SKIP_ENV_VALIDATION=1` would have been one line, but it disables the check wholesale — a genuinely missing or malformed variable would then pass CI unnoticed, which is the same defect class as a lint script that checks nothing. The workflow therefore supplies schema-satisfying dummy values, keeping the validation path exercised. They are not secrets and the workflow uses none.

## Happy path

Ordered, because D3's commit boundaries are the point — a reformat mixed into a config or CI commit is unreviewable.

1. Record Biome in `docs/development/tech-stack.md` and add it to the `pnpm-workspace.yaml` catalog. **Then** install it. (CLAUDE.md: declare before installing.)
2. Write `biome.json` from `recommended`. Add a `lint` script to all 8 workspace packages and to the root.
3. Run `biome check` read-only and read the whole violation list before changing a single file. Sort it into: auto-fixable, mechanical hand-fix, and behavioural. Report the third group; do not fix it here.
4. **Commit 1 — config.** `biome.json`, catalog entry, all 9 `package.json` changes, tech-stack doc. `pnpm lint` now runs and reports a non-zero file count; it may still be red.
5. **Commit 2 — the sweep.** `biome format --write` plus auto-fixes and mechanical hand-fixes only. No logic. Record its SHA in `.git-blame-ignore-revs` (which itself lands in commit 3, since the SHA does not exist until commit 2 is made).
6. **Commit 3 — tsconfig + CI.** `apps/web` extends the shared base; the workflow runs the five commands with a Postgres service container; `.git-blame-ignore-revs` gets commit 2's SHA.
7. Run the full verification block locally. Push and confirm CI reproduces it.
8. **Commit 4 — docs.** `CLAUDE.md` loses its `pnpm lint` caveat; `infrastructure.md` gains the CI description; `open-questions.md` marks #10, #11, #14 resolved.

## Acceptance criteria

- `biome.jsonc` exists at the repo root, and `docs/development/tech-stack.md` records Biome with its version and role **before** the dependency is installed.
- `pnpm lint` exits 0 **and** reports a checked-file count of **219 or more**. A run that checks 0 files fails this criterion; so does one that checks ~551, which means the config was dropped and build output is being linted (see D3a).
- `pnpm lint` covers `.claude/scripts/*.js` — verified by planting a violation in one of them, observing it, and removing it (D4a).
- Any Biome rule disabled in `biome.jsonc` carries a written reason on the adjacent line.
- `apps/web/tsconfig.json` extends `@fintech-ledger-sandbox/config/tsconfig.base.json`, and `pnpm check-types` stays 6/6 green.
- `noUncheckedIndexedAccess` is in force for `apps/web` — proven by planting a violation, observing the error, and removing it.
- The formatting sweep is a standalone commit whose SHA is listed in `.git-blame-ignore-revs`.
- A GitHub Actions workflow runs `lint`, `check-types`, `test`, `build`, and the migration integrity guard on push and pull request, with a Postgres service container so the db/api suites actually execute.
- The full verification block passes at or above the post-5h baseline: `check-types` 6/6, `test` 576, `build` 2/2, guard PASS.
- `CLAUDE.md`'s `pnpm lint` caveat (*"linter not wired yet — Biome/oxlint planned; do not claim lint passes until it exists"*) is removed, and open questions #10, #11, #14 are marked resolved with what closed them.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Baseline to beat, measured after 5h: `check-types` 6/6, `test` 576 passed (73 core + 243 web + 28 db + 232 api), `build` 2/2, guard PASS. `pnpm lint` did not exist.

**Result, verified 2026-07-28:** `lint` **exit 0, 219 files checked** (9 warnings, 17 infos outstanding — recorded as open question #16 rather than left to read as clean) · `check-types` **6/6 green** · `test` **576 passed** (73 core + 243 web + 28 db + 232 api — identical to the pre-sweep baseline, which is the evidence that a 118-file reformat changed no behaviour) · `build` **2/2 green** · migration guard **PASS**.

**Deliberate-failure probes, all three run and reverted:**

| Probe | Expected | Observed |
|---|---|---|
| `const b: string = a[0]` in `apps/web/src` | `noUncheckedIndexedAccess` rejects it | `TS2322: Type 'string \| undefined' is not assignable to type 'string'` |
| `probeVar == "1"` in `.claude/scripts/glob-match.js` | `pnpm lint` reaches files owned by no package | `glob-match.js:20:14 lint/suspicious/noDoubleEquals`, `pnpm lint` exit 1 → exit 0 after byte-exact restore |
| Commented `biome.json` vs `biome.jsonc` | config is actually being read | 551 files vs 219 — see D3a |

**Three things this slice got wrong in its own draft and corrected on measurement.** Recorded because each was stated confidently before being checked:

1. **#14's deferral reason was false.** "Cursor stacks, posting arrays, and paginated lists all index" predicted a wide diff; the real cost was 0 errors across 67 files. A phase-long deferral bought nothing.
2. **`services: postgres:` would have been dead weight** (D6). Testcontainers starts its own database; the requirement is a Docker daemon.
3. **A Turborepo fan-out would have left the guards unlinted** (D4a). There are 9 workspaces, not 8, and `.claude/scripts/*.js` belong to none of them.

**One real defect found by the linter**, fixed as a mechanical type annotation: `transactions.ts:275` declared `let after;` — implicitly `any` — so the pagination cursor crossed into `listTransactions` untyped. Now `TransactionCursor | undefined`. No runtime change; the annotation restores the type the repository boundary already assumed.

**One process finding for next time:** a single `biome check --write .` pass did **not** leave the repo clean. `packages/db/src/test/fixtures.ts` came out of the sweep still unformatted and the following read-only `biome check` failed on it. Always re-run `biome check` after a bulk `--write` — the write pass is not self-verifying. CI would have caught this on its first run, which is a fair demonstration of the slice's own premise.

## Retention

Archive to `docs/tasks/archive/2026/` on `Done`, once `tech-stack.md`, `infrastructure.md`, and `open-questions.md` reflect the outcome.

## Spec completeness checklist

### Common
- [x] Actor(s) defined — the engineer running verification, and CI acting on their behalf.
- [x] Entry point defined — `pnpm lint` locally; push/PR for CI.
- [x] Preconditions described — clean tree at post-5h baseline; Docker running for the db/api suites.
- [x] Happy path described — see the ordered "Happy path" section; the commit boundaries are the substance of it.
- [x] Error paths described — D2 (a check that passes vacuously), D4 (violations that are real defects), D6 (suites silently not running), plus step 3's three-way triage of the violation list.
- [x] Permissions considered — two distinct senses, neither left implicit. **CI:** no repository secrets; the workflow declares `permissions: contents: read` and uses only the default `GITHUB_TOKEN`. **Application roles:** untouched — this slice adds no procedure and no screen, so `docs/product/roles-and-permissions/ledger.md` needs no change and the `admin`/`member` distinction is not in play.
- [x] Acceptance criteria written
- [x] Tests defined — this slice adds no test suite; it makes the existing 576 run automatically. The `noUncheckedIndexedAccess` and non-zero-file-count criteria are the two assertions it does add, both verified by deliberate-failure probes.
- [x] Out of scope stated explicitly

### Backend
- [ ] API endpoints defined — `N/A: no API surface changes.`
- [ ] Validation described — `N/A: no request handling changes.`
- [ ] Error responses defined — `N/A: no API surface changes.`
- [x] Side effects listed — one repo-wide reformat (D3); no runtime, schema, or data effects.

### Frontend
- [ ] Loading state defined — `N/A: no UI changes.`
- [ ] Empty state defined — `N/A: no UI changes.`
- [ ] Error state defined — `N/A: no UI changes.`
- [ ] Navigation after each action defined — `N/A: no UI changes.`
- [ ] Feedback (toast/inline/modal) defined — `N/A: no UI changes.`

---

*Started 2026-07-28. If scope needs to expand mid-task, stop and update this section explicitly rather than just editing outside it — the hook will block it either way, so updating here is the only path forward.*
