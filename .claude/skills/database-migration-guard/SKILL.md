---
name: database-migration-guard
description: Migration history and seed safety reviewer. Use whenever migration SQL, ORM migration metadata/journals, schema snapshots, migration runners, or database seed scripts change. Checks disk history against applied history when a safe read-only connection is available, timestamp/order integrity, immutability of applied migrations, roll-forward recovery, and seed idempotency.
---

# Database Migration Guard

Protect migration history as an append-only deployment ledger. Read the database and ORM choices in `docs/development/tech-stack.md` first and use the repository's declared migration workflow. Do not assume Drizzle merely because the local static hook supports its journal format.

## Mandatory repository checks

1. Run `node .claude/scripts/migration-integrity-guard.js --check`. For Drizzle journals this blocks:
   - missing SQL files referenced by `meta/_journal.json`;
   - SQL files absent from the journal;
   - duplicate, missing, or out-of-order `idx` values;
   - duplicate or non-monotonic `when` timestamps;
   - duplicate migration tags.
2. Review the diff, not only the final tree. Applied migration files and their journal entries are immutable: deletion, rename, content edits, index rewrites, and timestamp rewrites are failures.
3. A repair must roll forward with a new migration. Never make local history look clean by rewriting what an environment may already have applied.
4. Run the ORM's supported migration validation/generation command and the project's migration tests when available.

## Applied-history reconciliation

When a safe read-only development/staging database connection is explicitly available, compare the database migration table with repository history before considering the change safe:

- every applied row maps to exactly one repository migration;
- name/tag, hash/checksum (when stored), and timestamp match;
- applied order is monotonic and is a prefix of, or otherwise valid under, the ORM's documented model;
- no repository migration has been inserted before an already-applied migration;
- no duplicate or partially recorded application exists.

Do not connect to production or print connection strings/secrets without explicit authorization. If no safe database is available, report applied-history reconciliation as **not verified**; a static hook cannot prove that applied migrations still exist on disk.

## Seed idempotency

Treat every seed as rerunnable. Check that it:

- uses stable natural/provider keys with upsert, insert-ignore, or an equivalent conflict strategy;
- does not depend on generated IDs, current row counts, array position, or execution timing;
- updates intended mutable fields without duplicating rows;
- runs twice in a disposable database with the same resulting row set and relationships;
- uses a transaction when partial application would leave invalid state;
- handles renamed/removed reference data deliberately rather than silently duplicating it.

Provider seeds (for example a carrier such as ForwardAir) must use the provider's stable identifier, preserve provider-to-internal mappings, and have a regression assertion for the expected row after two runs.

## Required output

Report separately:

1. Static repository history: pass/fail.
2. Applied database history: pass/fail/not verified, including the environment type but no secrets.
3. Seed rerun test: pass/fail/not applicable/not verified.
4. Required roll-forward repair and regression test.
