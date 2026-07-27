/**
 * The ledger's role model, and its translation from Better Auth's.
 *
 * `docs/product/requirements/ledger.md` §Permissions specifies two roles —
 * `admin` (all writes + reads within its org) and `viewer` (reads within its
 * org). Better Auth's organization plugin ships a different vocabulary:
 * `owner` / `admin` / `member`. Rather than reconfigure the plugin (which
 * would need a data migration for every existing `member.role` value) or
 * rewrite the product spec to match the library, the two are reconciled
 * here, at the API boundary — approved boundary decision 2 in
 * `docs/tasks/2026-07-27-phase-4a-api-foundation-reads.md`, and already the
 * direction Phase 3 recorded: "role mapping is enforced at the API boundary;
 * the schema stores a role string either way."
 *
 * This module is deliberately pure — a string in, a role out. It touches no
 * database and no session, so the mapping is trivially unit-testable and has
 * exactly one place to change if the product ever gains a third role.
 */

export type LedgerRole = "admin" | "viewer";

/** Better Auth roles that grant write access in this ledger. */
const WRITE_ROLES = new Set(["owner", "admin"]);

/**
 * Translates a Better Auth `member.role` value into a ledger role.
 *
 * **Fails closed.** Anything not explicitly recognized as a write role —
 * `member`, an empty string, a role a future Better Auth version introduces,
 * or a value hand-written into the column — maps to `viewer`. The failure
 * mode of guessing wrong in the other direction is granting write access to
 * a ledger on the strength of an unrecognized string, which is not a
 * trade-off worth making for convenience.
 *
 * Better Auth permits a member to hold **multiple** roles in one column as a
 * comma-separated list (e.g. `"admin,member"`). Any single write role in that
 * list is enough, matching how the plugin's own `hasPermission` treats them —
 * splitting here means a multi-role member isn't silently demoted to
 * `viewer` by a whole-string comparison that matches nothing.
 */
export function toLedgerRole(betterAuthRole: string): LedgerRole {
  const roles = betterAuthRole.split(",").map((role) => role.trim().toLowerCase());
  return roles.some((role) => WRITE_ROLES.has(role)) ? "admin" : "viewer";
}

/** Whether a ledger role may perform write operations. Reads are open to both roles. */
export function canWrite(role: LedgerRole): boolean {
  return role === "admin";
}
