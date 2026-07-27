import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Better Auth's organization plugin models, hand-written to match the
 * field shapes the plugin's Drizzle adapter expects (verified against the
 * pinned `better-auth@1.6.23` organization plugin schema — see
 * `docs/tasks/2026-07-27-phase-3-persistence-ledger-db.md`). Pure Drizzle,
 * no `better-auth` import: the adapter maps its internal model names
 * ("organization", "member", "invitation") onto these exported table
 * names, so the export identifiers matter as much as the columns.
 *
 * `organization` deliberately has no `updatedAt` in the plugin's own
 * default schema (only `member`/`session`/`user`/`account` get one) — it
 * is added here anyway as a nullable column for parity with every other
 * table in this file, and is simply never written by Better Auth itself.
 */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  // Better Auth's own field type for `metadata` is `"string"` (it
  // serializes/parses JSON itself at the plugin boundary), not a DB json
  // type — see `schema.mjs` in the installed package. `text`, not
  // `jsonb`, matches what the adapter actually reads and writes.
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Not `.notNull()` — the plugin's own field def marks `role` optional
    // on `invitation` (unlike `member.role`, which defaults to "member").
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));
