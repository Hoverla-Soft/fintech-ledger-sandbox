import type { Db } from "@fintech-ledger-sandbox/db";
import { member } from "@fintech-ledger-sandbox/db/schema/organization";
import { and, eq } from "drizzle-orm";

import { toLedgerRole, type LedgerRole } from "./roles";

export interface Membership {
  readonly orgId: string;
  readonly role: LedgerRole;
}

/**
 * Resolves the acting organization and role for a user — the single query
 * that makes ADR 0005's tenant isolation real.
 *
 * `session.activeOrganizationId` is set by Better Auth's organization plugin
 * and is the *claim* of which org a session is acting within. This function
 * turns that claim into a fact by requiring a matching `member` row. That
 * verification is the entire point: without it, the acting org would be
 * whatever the session says it is, and a stale value (an org the user was
 * removed from) or a tampered one would address another tenant's data through
 * every org-scoped query downstream.
 *
 * Returning `null` rather than throwing keeps the HTTP decision with the
 * middleware — this module has no opinion about status codes, matching how
 * `packages/core` and `packages/db` stay HTTP-agnostic.
 *
 * The role is normalized on the way out, so no caller downstream ever handles
 * a raw Better Auth role string and the `owner`/`admin`/`member` vocabulary
 * stops at this boundary.
 */
export async function resolveMembership(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);

  if (row === undefined) {
    return null;
  }

  return { orgId: organizationId, role: toLedgerRole(row.role) };
}
