# Remove the ⚠️ markers that describe already-fixed problems

## Goal

Fourteen ⚠️ markers exist across the showcase and development docs. An audit against the code
found **eight describing problems that no longer exist**, plus one claim that is outright false.
These pages are written for people evaluating this repository, so a stale warning is worse than a
missing one: it advertises a weakness that was fixed and undermines the accurate warnings beside
it.

No marker is removed on the strength of the prose around it. Each one below was checked against
the implementing code, and the replacement text says what the code now does.

| Marker | Verdict | Evidence |
|---|---|---|
| No RLS; a direct `packages/db` caller can read cross-org | **stale** | `packages/db/drizzle/0008_row_level_tenancy.sql` |
| Maker-checker enforced only in the browser | **stale** | `directPostProcedure`, `packages/api/src/procedures.ts:247` |
| Pool carries no `statement_timeout` (#28) | **stale** | `packages/db/src/index.ts:75` |
| Approval queue truncates at 100 rows (#29) | **stale** | cursor-paginated in `pending-transfers.ts` |
| Balance overflow is an unaudited 500 (#27) | **stale** | `BalanceLimitExceeded`, `packages/db/src/errors.ts:119` |
| Two reversals of one original both succeed | **stale** | unique partial index, migration `0007` |
| Client derives its own role | **stale** | `session.context` returns `{ userId, orgId, role }` |
| `features/theater/` is an empty placeholder | **stale** | directory deleted; README no longer references it |
| "CI has never executed a single run" | **false** | 13 runs, **7 passed the full five-step suite**; blocked only since 2026-08-16 21:03 UTC |

Genuinely open markers are **kept**: the privileged-role trigger bypass, the unversioned
`request_hash`, in-process rate-limit counters, the body-borne idempotency key, `actorId`
excluded from the hash, contention latency, on-demand reconciliation, and reversal chains.

## Scope (allowed paths)

- `docs/tasks/2026-08-19-stale-gap-marker-sweep.md`
- `docs/showcase/architecture.md`
- `docs/showcase/engineering-playbook.md`
- `docs/showcase/teardowns/01-money-that-cannot-go-missing.md`
- `docs/showcase/teardowns/03-multi-tenancy-without-leaks.md`
- `docs/showcase/videos/README.md`
- `docs/development/tech-stack.md`

## Out of scope

- Any code change. This is a documentation-accuracy sweep; if a marker turns out to be real, it
  stays and gets its own task.
- The remaining dangling `docs/open-questions.md` citations in source comments. Tracked separately.

## Acceptance criteria

1. Every removed marker's replacement names the file, migration, or test that closed it.
2. Every genuinely open marker survives, unchanged in substance.
3. No dead `docs/open-questions.md` link remains in the touched files.
4. The e2e count reads 4, not 3.
5. Lint and the full test suite stay green.

## Verification

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

## Status

**Done.** Nine stale or false markers removed or corrected; eight genuinely open ones kept.

Every removal names the migration, file, or index that closed it, so a reader can check the claim
rather than take it. Three dead `docs/open-questions.md` links surfaced in the touched files and
were repointed at the security checklist, which is where those items actually live now; one
mermaid node still listed the deleted file and was relabelled.

### Kept, because they are real

The privileged-role trigger bypass and on-demand reconciliation (teardown 01); the unversioned
`request_hash`, the body-borne key, `actorId` excluded from the hash, and contention latency
(teardown 02); reversal *chains* (architecture §3); in-process rate-limit counters
(security checklist); thin e2e coverage — corrected from 3 specs to 4; and CI not currently
running, rewritten everywhere to say what is true rather than "has never run".

### The CI claim

Three files asserted CI had never executed. It has: **thirteen runs, seven of which passed the
full five-step suite.** Nothing has run since 2026-08-16 21:03 UTC, for every account including
Dependabot, while both billing pages show nothing owed. All three now say that instead.
