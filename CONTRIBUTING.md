# Contributing

Thanks for looking. This repository is the reference implementation for HoverlaSoft's AI-first
engineering standard, which means the *process* is part of what it demonstrates — a change that
skips the process is less useful here than no change at all.

## Before you start

Read [`CLAUDE.md`](CLAUDE.md). It is the project constitution: it declares how work is scoped,
which guards run, and where the source of truth for each decision lives. It is short, and it is
loaded automatically by every agent session in this repo.

Two rules matter more than the rest:

- **Nothing gets installed that isn't declared.** If a change needs a library not listed in
  [`docs/development/tech-stack.md`](docs/development/tech-stack.md), that file is updated first —
  with the reasoning — before the dependency is added.
- **Never make a check pass by weakening it.** A red test, a lint error, or a type error is
  information. Narrowing the rule until it goes green destroys that information.

## How a change happens

1. **Open an issue first** for anything beyond a typo. Use the
   [templates](.github/ISSUE_TEMPLATE/); describe the behaviour, not the patch you have in mind.
2. **Write a task file.** Copy [`docs/tasks/TEMPLATE.md`](docs/tasks/TEMPLATE.md). The important
   part is the **Scope** block — the explicit list of paths the change is allowed to touch. A
   `PreToolUse` hook enforces it, so edits outside the declared scope are blocked rather than
   discouraged.
3. **Implement inside that scope.** If the work turns out to need files outside it, stop and say
   so in the issue. Scope creep gets caught here on purpose.
4. **Record decisions that outlive the change.** A structural or correctness decision belongs in
   an [ADR](docs/adr/), not only in a commit message.
5. **Update the docs the change invalidates.** Documentation drift is treated as a defect. If a
   change makes a line in `docs/` wrong, fixing that line is part of the change.

## The quality gate

Every one of these must pass before a pull request is ready. They are the same commands CI runs.

```bash
pnpm lint                                          # Biome — lint + format, warnings fail
pnpm check-types                                   # TypeScript across every workspace
pnpm test                                          # unit, component, integration (needs Docker)
pnpm build
node .claude/scripts/migration-integrity-guard.js --check
```

Integration suites drive real PostgreSQL through Testcontainers, so a reachable Docker daemon is
required. They are not mocked, and they should not become mocked.

## Working on the ledger itself

The eight invariants in
[`docs/product/requirements/ledger.md`](docs/product/requirements/ledger.md) are the correctness
spec. They are not guidelines — each is enforced somewhere specific and covered by a test. A
change that touches money movement, tenancy, or history needs to say which invariants it affects
and how it keeps them.

Some things that look like reasonable simplifications are load-bearing, and there is a written
reason for each:

- Money is a `bigint` count of minor units. Never a float, never a decimal string in arithmetic.
  ([ADR 0002](docs/adr/0002-money-representation.md))
- Idempotency keys are reserved with a plain blocking `INSERT`, deliberately **not**
  `ON CONFLICT DO NOTHING`. ([ADR 0004](docs/adr/0004-idempotency.md))
- Account locks are deduplicated and **sorted** before acquisition, so deadlock is structurally
  impossible rather than retried away. ([ADR 0003](docs/adr/0003-balance-and-concurrency.md))
- No API input schema may carry an organization id, and a test walks the live router to enforce
  it. ([ADR 0005](docs/adr/0005-tenant-isolation.md))

## Commits and pull requests

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`), scoped where it
helps — `feat(transactions): …`. One logical change per pull request; describe what changed, why,
and what you ran to verify it.

## Reporting a vulnerability

Do not open a public issue. See [SECURITY.md](SECURITY.md).
