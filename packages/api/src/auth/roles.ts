/**
 * Ledger roles vs Better Auth's organization roles.
 *
 * Product: `admin` (writes+reads) / `viewer` (reads). Better Auth stores
 * `owner` / `admin` / `member`. Mapped here at the API boundary so the schema
 * can keep the plugin's strings.
 *
 * Pure — string in, role out. Fail closed: unrecognized → `viewer`.
 */

export type LedgerRole = "admin" | "viewer";

/** Better Auth roles that grant write access in this ledger. */
const WRITE_ROLES = new Set(["owner", "admin"]);

/**
 * Translates a Better Auth `member.role` value into a ledger role.
 *
 * Better Auth may store multiple roles as a comma-separated list; any write
 * role in the list is enough. Missing/non-string values fail closed to
 * `viewer` so the console can call this with a loading member row.
 */
export function toLedgerRole(betterAuthRole: string | null | undefined): LedgerRole {
  if (typeof betterAuthRole !== "string") {
    return "viewer";
  }
  const roles = betterAuthRole.split(",").map((role) => role.trim().toLowerCase());
  return roles.some((role) => WRITE_ROLES.has(role)) ? "admin" : "viewer";
}

/** Whether a ledger role may perform write operations. Reads are open to both. */
export function canWrite(role: LedgerRole): boolean {
  return role === "admin";
}
