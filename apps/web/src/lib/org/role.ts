/**
 * The console's view of the caller's role.
 *
 * Deliberately duplicates `toLedgerRole` in `packages/api/src/auth/roles.ts`:
 * no procedure returns the caller's role (open question #1), so the console can
 * only read Better Auth's `member.role` and apply the same mapping.
 * `role.test.ts` pins the two in agreement so they cannot drift.
 *
 * This decides nothing. It chooses whether to *render* an affordance, never
 * whether a request succeeds — the session may be cached and stale where the
 * server's read never is. Hidden button is a courtesy; the 403 is the truth
 * (`docs/product/roles-and-permissions/ledger.md:64`).
 */

export type LedgerRole = "admin" | "viewer";

/**
 * Better Auth roles that grant write access. Mirrors `WRITE_ROLES` in
 * `packages/api/src/auth/roles.ts` — if that set changes, this must too, and
 * the agreement test will fail until it does.
 */
const WRITE_ROLES = new Set(["owner", "admin"]);

/**
 * Translates a Better Auth `member.role` value into a ledger role.
 *
 * **Fails closed**, exactly as the server does — anything not explicitly a
 * write role is `viewer`. Showing a write affordance the server will refuse is
 * worse than hiding one someone could have used.
 *
 * Better Auth permits multiple roles in one column as a comma-separated list
 * (`"admin,member"`); any single write role in the list is enough, matching
 * the plugin's own `hasPermission`.
 */
export function toLedgerRole(betterAuthRole: string | null | undefined): LedgerRole {
  if (typeof betterAuthRole !== "string") {
    return "viewer";
  }
  const roles = betterAuthRole.split(",").map((role) => role.trim().toLowerCase());
  return roles.some((role) => WRITE_ROLES.has(role)) ? "admin" : "viewer";
}

/** Reads are open to both. */
export function canWrite(role: LedgerRole): boolean {
  return role === "admin";
}
