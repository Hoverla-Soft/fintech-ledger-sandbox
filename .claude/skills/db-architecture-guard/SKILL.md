---
name: db-architecture-guard
description: Database architecture reviewer for TypeScript monorepos, on whatever SQL/ORM stack is declared in docs/development/tech-stack.md. Use whenever a task touches database schema, migrations, repositories, SQL/ORM queries, or any backend endpoint/service that reads or writes data. Pushes toward designing the schema and access pattern before writing queries, not just producing working SQL.
---

# DB Architecture Guard

Make the AI think about database architecture, not just produce working SQL or ORM queries. Check `docs/development/tech-stack.md` for the actual database and ORM in use — this skill is written generically on purpose and doesn't assume a specific one; the checks below apply regardless of whether it's Drizzle, Prisma, or raw SQL on Postgres, MySQL, or something else. See `docs/development/architecture.md` for this repo's package boundaries — `packages/db` owns schema and repositories, `packages/core` owns business rules, per the default boundary model.

## Database design

- Design the schema before writing queries.
- Normalize data unless denormalization has a measurable, stated benefit.
- Avoid duplicate data when it can be derived instead.
- Prefer explicit relations and foreign keys.
- Use appropriate indexes for filtering, sorting, joins, and unique constraints.
- Think about future scalability, not only the current feature.

## Queries

- Avoid N+1 queries.
- Select only required columns.
- Prefer one optimized query over multiple sequential ones when reasonable.
- Keep transactions as short as possible.
- Consider query performance before implementation, not after it's slow.
- Think about pagination from the beginning, not as a follow-up.

## Repositories

- Keep SQL/ORM logic inside repositories or services — not in controllers/routes.
- Repositories stay focused on persistence only; business rules belong in services (`packages/core`), not in the repository.
- Database access does not happen directly from `apps/api` route handlers.

## Migrations

- Never modify old migrations — create a new migration for schema changes.
- Consider migration safety for production data (locking, long-running backfills on large tables).
- Avoid destructive migrations unless explicitly requested and confirmed.
- Use the migration workflow declared in `docs/development/tech-stack.md` (e.g. `drizzle-kit`, `prisma migrate`, hand-written SQL) — don't introduce a second one.

## Indexes

Before finishing, verify whether indexes are needed for:

- foreign keys
- search fields
- sorting
- unique constraints
- frequently filtered columns

## API

For every endpoint, think about:

- filtering
- sorting
- pagination
- permissions
- tenant isolation (if applicable — see Optional Architecture Checks)

## Providers / integrations

When storing data that originates from an external provider (see `docs/integrations/`):

- Separate provider-specific fields from generic business entities.
- Don't leak provider implementation details into the whole schema.
- Keep the mapping layer isolated in `packages/integrations`.
- Design the schema so a second provider can be added without a schema rewrite — see `docs/development/architecture.md`'s provider abstraction model.

## Performance

Before finishing, ask:

- Can this query use indexes?
- Is there unnecessary data loading?
- Is pagination required?
- Can this become slow at 1M+ rows?
- Is caching needed?

## Data modeling checklist

Before implementing a new table, answer:

- What is the entity?
- Who owns it?
- What is its lifecycle?
- Is it tenant-scoped?
- Can it be soft deleted?
- Does it require audit fields?
- What indexes are required?
- Can multiple providers reference it?
- Should this be normalized or embedded?
- How will it be queried most often?

## Read/write pattern

Before designing the schema, identify:

- Main write operations.
- Main read operations.
- Dashboard queries.
- Search queries.
- Reporting queries.

Optimize the schema for the most common access pattern, not only for inserts. This and the data modeling checklist above are the two things that most separate "good SQL" from actual architectural thinking — apply them even on a small feature.

## Conditional checks

Do not assume every project uses multi-tenancy, dashboards, provider synchronization, or role-based permissions.

Before applying an optional check below:

1. Inspect the affected schema, services, routes, and existing project patterns.
2. Determine whether the pattern already exists, or is introduced by the current task.
3. Apply only the relevant checks.
4. Do not invent missing infrastructure unless the task requires it.
5. State which optional checks were applied and which were not applicable, and why.

## Optional architecture checks

Apply the following only when the relevant pattern exists in the codebase or is affected by the current task.

### Shared-table multi-tenancy

If tenant-scoped entities exist:

- Verify tenant-owned tables include `organizationId` (or another explicit tenant key).
- Verify all reads, updates, and deletes are scoped by tenant.
- Verify unique constraints include the tenant key when uniqueness is tenant-specific.
- Verify joins cannot accidentally cross tenant boundaries.
- Verify background jobs, webhooks, and admin actions preserve tenant context.
- Do not introduce tenant scoping into global/reference tables without a clear reason.

### Dashboard statistics

If the task touches dashboards, analytics, counters, or reports:

- Aggregate in SQL instead of loading full datasets into application memory.
- Verify date range and timezone handling.
- Clarify whether metrics are all-time, monthly, rolling-period, or custom-range.
- Avoid a separate query per widget when queries can be safely combined.
- Check whether expensive aggregates need caching, pre-aggregation, or materialized views.
- Verify statistics are tenant-scoped when required.

### Provider capability sync

If the system stores external provider capabilities, configuration, or supported rails (see `docs/integrations/`):

- Keep provider-specific data isolated from generic domain entities.
- Treat the provider as source of truth only for fields it actually owns.
- Define how capability data is created, refreshed, disabled, and expired.
- Make synchronization idempotent.
- Prevent stale syncs from overwriting newer data.
- Store provider identifiers separately from internal identifiers.
- Define fallback behavior when the provider is unavailable.
- Verify whether capabilities are global, environment-specific, account-specific, or organization-specific.

### Permissions and authorization

If the task touches protected data or actions:

- Verify authorization on the backend, not only in the UI.
- Separate role checks from resource ownership and tenant checks.
- Verify permissions for create, read, update, delete, export, and administrative actions.
- Prevent users from accessing resources by guessing IDs.
- Check whether platform administrators intentionally bypass tenant restrictions, and that this is deliberate.
- Keep permission rules centralized and testable.
- Hidden UI controls are not security enforcement.

### Query plan analysis

If a query is complex, frequently executed, processes large datasets, or is suspected to be slow:

- Review the generated SQL.
- Use `EXPLAIN` or `EXPLAIN ANALYZE` in a safe development or staging environment.
- Check for sequential scans on large tables.
- Check whether joins, sorting, and filtering use suitable indexes.
- Compare estimated rows with actual rows when using `EXPLAIN ANALYZE`.
- Do not add indexes blindly — verify the query pattern actually benefits.
- Do not run `EXPLAIN ANALYZE` against destructive statements or sensitive production workloads without explicit approval.

## Review output

Always review:

- Schema correctness
- Relations and constraints
- Query safety
- Transaction boundaries
- Migration safety
- Index requirements
- Repository and service boundaries

When applicable, also review:

- Tenant isolation
- Dashboard aggregation
- Provider capability synchronization
- Authorization and permissions
- Query plans and `EXPLAIN ANALYZE`

Point out architectural issues before writing code, not after.
