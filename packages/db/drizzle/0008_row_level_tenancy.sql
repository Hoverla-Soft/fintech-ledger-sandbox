-- Custom SQL migration file, put your code below! --

-- Invariant #5 (docs/product/requirements/ledger.md): no read or write ever
-- crosses an org boundary. ADR 0005 enforces that in `packages/api` — every
-- repository filters on `org_id`, and the `org_id` itself comes from a verified
-- `member` row rather than from request input. Postgres, until now, had no
-- opinion: a query that simply forgot the predicate returned every tenant's
-- rows. This migration makes the database fail closed instead.
--
-- Two facts drive the shape below.
--
-- First, a table's OWNER is exempt from row-level security unless the table is
-- also marked FORCE. The application connects as the owner, so policies attached
-- to the owner would do nothing. Rather than FORCE (which would also subject
-- migrations, the Testcontainers truncate harness, and every test fixture that
-- inserts a ledger row directly), this creates a separate, unprivileged role.
-- The owner keeps its bypass, so migrations and fixtures are untouched, and the
-- application drops into the restricted role for the duration of each org-scoped
-- request — see `withOrgScope` in `packages/db/src/tenancy.ts`.
--
-- Second, `current_setting('app.current_org_id', true)` returns NULL when the
-- setting was never assigned, and `org_id = NULL` is NULL, which is not TRUE.
-- So a query issued as `ledger_app` without a scope matches no rows at all
-- rather than matching everything. That is the property worth having: forgetting
-- to scope yields nothing, not everyone's data.
--
-- The role is NOLOGIN. It is reached with `SET LOCAL ROLE`, which reverts at
-- COMMIT, so a pooled connection is never left in a switched state. Granting it
-- LOGIN and pointing DATABASE_URL at it is a further hardening step available
-- later without touching application code: `SET LOCAL ROLE ledger_app` is a
-- no-op when the session is already that role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE "ledger_app" NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

-- The application's own role must be a member of `ledger_app` to SET ROLE into
-- it. Granted to CURRENT_USER rather than a hardcoded name so this works against
-- the local docker-compose `postgres` user, the Testcontainers user, and
-- whatever a deployment happens to connect as. Guarded rather than re-granted so
-- a second apply is silent: roles are cluster-wide, so a second database in the
-- same cluster will find this already done.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles grantee ON grantee.oid = m.member
    WHERE granted.rolname = 'ledger_app' AND grantee.rolname = CURRENT_USER
  ) THEN
    EXECUTE format('GRANT "ledger_app" TO %I', CURRENT_USER);
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "ledger_app";
--> statement-breakpoint

-- One policy per org-scoped table, plus the matching grant.
--
-- The privileges are the narrowest set each table's real access pattern needs,
-- so the role cannot do more than the application actually does. `ledger_posting`
-- and `ledger_audit_entry` get no UPDATE because both are append-only;
-- `ledger_transaction` gets none because a transaction is never amended, only
-- reversed by a new one. Nothing gets DELETE or any DDL, and the role owns
-- nothing.
--
-- `organization` is included because `getOrgSettings` / `setRequireTransferApproval`
-- read and write it from inside a scoped handler. Its org column is `id`, not
-- `org_id`. Better Auth's other tables (`user`, `session`, `account`,
-- `verification`, `member`, `invitation`) are deliberately absent: they hold no
-- org-scoped ledger rows, and `member` in particular is read by `requireOrg`
-- BEFORE the scope opens, to decide what the scope should be.
DO $$
DECLARE
  spec record;
  policy_name text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('ledger_account',          'org_id', 'SELECT, INSERT, UPDATE'),
      ('ledger_transaction',      'org_id', 'SELECT, INSERT'),
      ('ledger_posting',          'org_id', 'SELECT, INSERT'),
      ('ledger_idempotency_key',  'org_id', 'SELECT, INSERT, UPDATE'),
      ('ledger_audit_entry',      'org_id', 'SELECT, INSERT'),
      ('ledger_pending_transfer', 'org_id', 'SELECT, INSERT, UPDATE'),
      ('organization',            'id',     'SELECT, UPDATE')
    ) AS t(table_name, org_column, privileges)
  LOOP
    policy_name := spec.table_name || '_org_isolation';

    EXECUTE format('GRANT %s ON %I TO "ledger_app"', spec.privileges, spec.table_name);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', spec.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, spec.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO "ledger_app"'
      || ' USING (%I = current_setting(''app.current_org_id'', true))'
      || ' WITH CHECK (%I = current_setting(''app.current_org_id'', true))',
      policy_name, spec.table_name, spec.org_column, spec.org_column
    );
  END LOOP;
END
$$;
