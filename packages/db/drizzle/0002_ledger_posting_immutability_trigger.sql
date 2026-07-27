-- Custom SQL migration file, put your code below! --

-- Invariant #8 (docs/product/requirements/ledger.md): postings are
-- append-only, never mutated or deleted once inserted. This cannot be
-- expressed in Drizzle's schema DSL, so it is enforced here as a database
-- trigger rather than trusted to application code. Corrections are always
-- a new, separate reversing transaction linked via
-- ledger_transaction.reverses_transaction_id — never an UPDATE/DELETE on
-- an existing posting.
--
-- CREATE OR REPLACE (function) and DROP TRIGGER IF EXISTS (each trigger)
-- make this migration re-runnable rather than failing on a second apply.
--
-- The function references neither NEW nor OLD, so the same function backs
-- both a row-level trigger (UPDATE/DELETE) and a statement-level trigger
-- (TRUNCATE) — TRUNCATE never fires row-level triggers in Postgres, so
-- without the second trigger below, `TRUNCATE ledger_posting` (or a
-- `TRUNCATE ... CASCADE` cascading from `organization`) would silently
-- wipe append-only history despite the row-level trigger being in place.
CREATE OR REPLACE FUNCTION "ledger_posting_block_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_posting is append-only: % is not permitted on an existing posting (invariant #8). Post a reversing transaction instead.', TG_OP;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_posting_immutability_trigger" ON "ledger_posting";
--> statement-breakpoint
CREATE TRIGGER "ledger_posting_immutability_trigger"
BEFORE UPDATE OR DELETE ON "ledger_posting"
FOR EACH ROW
EXECUTE FUNCTION "ledger_posting_block_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_posting_immutability_truncate_trigger" ON "ledger_posting";
--> statement-breakpoint
CREATE TRIGGER "ledger_posting_immutability_truncate_trigger"
BEFORE TRUNCATE ON "ledger_posting"
FOR EACH STATEMENT
EXECUTE FUNCTION "ledger_posting_block_mutation"();
