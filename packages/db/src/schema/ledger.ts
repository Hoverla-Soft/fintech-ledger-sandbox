/**
 * ## Why every `created_at` here declares `precision: 3`
 *
 * Postgres `timestamp` defaults to **microsecond** precision. JavaScript's
 * `Date` — what Drizzle hands back for a timestamp column — holds only
 * **milliseconds**. Left at the default, every timestamp that crosses into
 * application code is silently truncated, and any value sent back to Postgres
 * for comparison is therefore strictly *smaller* than the row it came from.
 *
 * That is not theoretical. It broke cursor pagination in
 * `repositories/transactions.ts`: a row stored at `21:14:05.884495` came back
 * as `21:14:05.884`, the cursor sent `21:14:05.884`, and
 * `created_at > cursor` matched that same row again — so the last row of
 * every page reappeared as the first row of the next. Found in Phase 4a by
 * the API layer's multi-page pagination test (see
 * `docs/tasks/2026-07-27-phase-4a-api-foundation-reads.md` → Scope
 * expansions).
 *
 * Pinning storage to millisecond precision makes the database and the
 * language agree exactly, so a `Date` round-trips without loss and the
 * ordinary `>` comparison is correct as written. The alternative — teaching
 * one cursor to carry microseconds — would have fixed pagination alone and
 * left the same mismatch waiting for the next timestamp comparison anyone
 * wrote. Do not remove `precision: 3` without re-solving that problem.
 */

import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { organization } from "./organization";

/**
 * The ledger schema (`docs/product/requirements/ledger.md`,
 * `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`). Deliberately
 * not part of `packages/db`'s public export map — the posting routine and
 * read repositories (both internal to this package) are the only intended
 * access path to these tables; a caller outside `packages/db` never
 * imports this module directly.
 *
 * Money columns use `bigint(..., { mode: "bigint" })` so they round-trip
 * as JS `bigint`, matching `packages/core`'s `Money.minorUnits` with no
 * lossy `number` hop (ADR 0002). `currency` is plain `text`, not a
 * Postgres enum: the known-currency allowlist is owned exclusively by
 * `packages/core/src/money/currency.ts` (`Currency`), and a DB enum would
 * duplicate that allowlist in a second place that needs its own migration
 * every time the domain's list changes.
 *
 * Invariant #8 (immutable history) is enforced by a trigger on
 * `ledger_posting` that rejects `UPDATE`/`DELETE` — that trigger cannot be
 * expressed in Drizzle's schema DSL and lives in a separate custom SQL
 * migration instead.
 */

export const ledgerAccountTypeEnum = pgEnum("ledger_account_type", ["normal", "external"]);
export const ledgerPostingDirectionEnum = pgEnum("ledger_posting_direction", ["debit", "credit"]);
export const ledgerAuditOutcomeEnum = pgEnum("ledger_audit_outcome", ["posted", "rejected"]);

export const ledgerAccount = pgTable(
  "ledger_account",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    type: ledgerAccountTypeEnum("type").notNull(),
    // Materialized balance — always kept equal to the signed sum of this
    // account's postings (reconciliation invariant #2). Starts at zero for
    // a freshly created account with no postings yet. Default is a raw SQL
    // expression, not a JS `0n` literal: drizzle-kit 0.31's schema-diff
    // snapshotting cannot `JSON.stringify` a native `bigint` default value
    // (throws `TypeError: Do not know how to serialize a BigInt`) — an
    // `sql` default sidesteps that entirely since it's stored as a string.
    balance: bigint("balance", { mode: "bigint" }).notNull().default(sql`0`),
    active: boolean("active").notNull().default(true),
    // `precision: 3` is load-bearing — see the note at the top of this file.
    createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // No standalone `org_id` index here: the leading column of the unique
    // constraint below already covers `org_id`-only lookups, and a second
    // single-column index would just be write amplification for zero read
    // benefit.
    unique("ledger_account_orgId_name_unique").on(table.orgId, table.name),
    // Composite unique target for `ledger_posting`'s `(account_id, org_id)`
    // FK (invariant #5 defense-in-depth) — Postgres requires a unique
    // constraint on exactly the referenced column set, and the plain `id`
    // primary key alone doesn't satisfy a two-column reference.
    unique("ledger_account_id_orgId_unique").on(table.id, table.orgId),
  ],
);

export const ledgerTransaction = pgTable(
  "ledger_transaction",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    // Self-FK: links a reversal to the transaction it reverses. Nullable —
    // most transactions reverse nothing.
    reversesTransactionId: text("reverses_transaction_id").references(
      (): AnyPgColumn => ledgerTransaction.id,
    ),
    // The actor (org admin) who submitted this transfer. Financial
    // provenance must survive the acting user's own account being deleted,
    // so this intentionally omits `onDelete: "cascade"` (defaults to no
    // action, blocking deletion of a referenced user) rather than
    // following `schema/auth.ts`'s cascade convention for ephemeral
    // auth records.
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    // `precision: 3` is load-bearing — see the note at the top of this file.
    createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // No standalone `org_id` index here: the composite index below already
    // covers `org_id`-only lookups via its leading column.
    // Cursor pagination: org-scoped history ordered by creation, `id` as
    // the tiebreaker for rows with an identical `createdAt`.
    index("ledger_transaction_orgId_createdAt_id_idx").on(table.orgId, table.createdAt, table.id),
    // Composite unique target for `ledger_posting`'s `(transaction_id,
    // org_id)` FK (invariant #5 defense-in-depth).
    unique("ledger_transaction_id_orgId_unique").on(table.id, table.orgId),
    // Reverse direction of the self-FK above: "has this transaction been
    // reversed?", which the FK alone cannot answer efficiently — it points
    // forwards only, so without this the lookup is a sequential scan.
    //
    // Partial, because `reverses_transaction_id` is NULL for every
    // transaction that is not itself a reversal — the overwhelming majority.
    // The index then holds only rows the lookup can ever match.
    //
    // Deliberately NOT unique: a transaction may be reversed more than once.
    // `transactions.reverse` performs no existing-reversal check and nothing
    // in the schema forbids a second one, so the read side returns a *list*
    // of reversals (see the 6b task file, D3). Adding UNIQUE here would be a
    // product decision that silently invalidates existing data.
    index("ledger_transaction_reversesTransactionId_idx")
      .on(table.reversesTransactionId)
      .where(sql`${table.reversesTransactionId} is not null`),
  ],
);

export const ledgerPosting = pgTable(
  "ledger_posting",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // No column-level `.references()` on `transactionId`/`accountId`
    // below: each is covered instead by a composite `foreignKey()` against
    // `(id, org_id)` in the table config, so the database — not just the
    // application — rejects a posting whose `org_id` disagrees with its
    // referenced transaction's or account's owning org (invariant #5
    // defense-in-depth).
    transactionId: text("transaction_id").notNull(),
    accountId: text("account_id").notNull(),
    direction: ledgerPostingDirectionEnum("direction").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    // Redundant with both `ledger_transaction.currency` and
    // `ledger_account.currency` — a deliberate denormalization, not an
    // oversight. `ledger_posting` is the append-only historical record
    // (invariant #8), so snapshotting the currency at write time keeps
    // each row self-describing independent of any later state the
    // referenced account or transaction might reach.
    currency: text("currency").notNull(),
    // Append-only — see the immutability trigger in its own custom
    // migration. Never mutated or deleted once inserted.
    // `precision: 3` is load-bearing — see the note at the top of this file.
    createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Standalone `org_id` index kept: unlike the other ledger tables, no
    // composite index/unique constraint here starts with `org_id`, so this
    // is the only thing covering `org_id`-only lookups.
    index("ledger_posting_orgId_idx").on(table.orgId),
    index("ledger_posting_accountId_createdAt_idx").on(table.accountId, table.createdAt),
    index("ledger_posting_transactionId_idx").on(table.transactionId),
    check("ledger_posting_amount_positive", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.accountId, table.orgId],
      foreignColumns: [ledgerAccount.id, ledgerAccount.orgId],
      name: "ledger_posting_account_id_org_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.transactionId, table.orgId],
      foreignColumns: [ledgerTransaction.id, ledgerTransaction.orgId],
      name: "ledger_posting_transaction_id_org_id_fk",
    }).onDelete("cascade"),
  ],
);

export const ledgerIdempotencyKey = pgTable(
  "ledger_idempotency_key",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    // Nullable and backfilled after the transaction is created — the
    // posting routine reserves the key *before* the transaction exists
    // (see the ADR 0004 idempotency design), so this starts null and stays
    // null for a rejected attempt.
    transactionId: text("transaction_id").references(() => ledgerTransaction.id, {
      onDelete: "cascade",
    }),
    // `precision: 3` is load-bearing — see the note at the top of this file.
    createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // No standalone `org_id` index here: the unique constraint below
    // already covers `org_id`-only lookups via its leading column.
    // This constraint *is* invariant #4: one idempotency key per org can
    // ever be reserved, so a concurrent duplicate blocks on it rather than
    // silently posting twice.
    unique("ledger_idempotency_key_orgId_key_unique").on(table.orgId, table.key),
  ],
);

export const ledgerAuditEntry = pgTable(
  "ledger_audit_entry",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id),
    action: text("action").notNull(),
    // Discriminates posted vs. rejected — "rejections" is a filtered query
    // against this single table, not a second table.
    outcome: ledgerAuditOutcomeEnum("outcome").notNull(),
    reason: text("reason"),
    transactionId: text("transaction_id").references(() => ledgerTransaction.id, {
      onDelete: "cascade",
    }),
    metadata: jsonb("metadata"),
    // `precision: 3` is load-bearing — see the note at the top of this file.
    createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // No standalone `org_id` index here: the composite index below already
    // covers `org_id`-only lookups via its leading column.
    index("ledger_audit_entry_orgId_createdAt_idx").on(table.orgId, table.createdAt),
  ],
);

export const ledgerAccountRelations = relations(ledgerAccount, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ledgerAccount.orgId],
    references: [organization.id],
  }),
  postings: many(ledgerPosting),
}));

export const ledgerTransactionRelations = relations(ledgerTransaction, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ledgerTransaction.orgId],
    references: [organization.id],
  }),
  createdByUser: one(user, {
    fields: [ledgerTransaction.createdBy],
    references: [user.id],
  }),
  postings: many(ledgerPosting),
  reversesTransaction: one(ledgerTransaction, {
    fields: [ledgerTransaction.reversesTransactionId],
    references: [ledgerTransaction.id],
  }),
}));

export const ledgerPostingRelations = relations(ledgerPosting, ({ one }) => ({
  organization: one(organization, {
    fields: [ledgerPosting.orgId],
    references: [organization.id],
  }),
  transaction: one(ledgerTransaction, {
    fields: [ledgerPosting.transactionId],
    references: [ledgerTransaction.id],
  }),
  account: one(ledgerAccount, {
    fields: [ledgerPosting.accountId],
    references: [ledgerAccount.id],
  }),
}));

export const ledgerIdempotencyKeyRelations = relations(ledgerIdempotencyKey, ({ one }) => ({
  organization: one(organization, {
    fields: [ledgerIdempotencyKey.orgId],
    references: [organization.id],
  }),
  transaction: one(ledgerTransaction, {
    fields: [ledgerIdempotencyKey.transactionId],
    references: [ledgerTransaction.id],
  }),
}));

export const ledgerAuditEntryRelations = relations(ledgerAuditEntry, ({ one }) => ({
  organization: one(organization, {
    fields: [ledgerAuditEntry.orgId],
    references: [organization.id],
  }),
  actor: one(user, {
    fields: [ledgerAuditEntry.actorUserId],
    references: [user.id],
  }),
  transaction: one(ledgerTransaction, {
    fields: [ledgerAuditEntry.transactionId],
    references: [ledgerTransaction.id],
  }),
}));
