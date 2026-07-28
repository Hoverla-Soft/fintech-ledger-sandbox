/**
 * The console's view of the caller's role.
 *
 * ## Why this is duplicated logic, deliberately
 *
 * No procedure in `packages/api` returns the caller's role. It is derived
 * inside `requireOrg` and lives only in middleware context
 * (`packages/api/src/procedures.ts`), so the console cannot ask "am I an admin
 * here?" — it can only ask Better Auth what `member.role` says and apply the
 * same mapping. Adding a role-returning procedure would reopen `packages/api`
 * inside a frontend slice and drag `no-org-input.test.ts`'s pinned procedure
 * count with it; it is recorded as open question #1 instead.
 *
 * The duplication is therefore intentional but must not be allowed to drift.
 * `role.test.ts` asserts this function agrees with `toLedgerRole`
 * (`packages/api/src/auth/roles.ts`) case for case.
 *
 * ## This decides nothing
 *
 * `docs/product/roles-and-permissions/ledger.md:64` — *"'The frontend hides
 * the button' is not enforcement anywhere in this system."* The value here
 * chooses whether to *render* an affordance. It never gates a request, and
 * every write path still handles `403 insufficient_role`, because:
 *
 * - the server re-reads `member.role` on **every** org-scoped request, so a
 *   demotion takes effect on the caller's next request with no sign-out
 *   (`ledger.md:68`); and
 * - this value comes from a session Better Auth may have cached, so it can be
 *   stale in a way the server's never is.
 *
 * Treat a hidden button as a courtesy and the 403 as the truth.
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
 * **Fails closed**, exactly as the server does. Anything not explicitly a
 * write role — `member`, an empty string, a role a future Better Auth version
 * introduces, or a value hand-written into the column — is `viewer`. Guessing
 * wrong in the other direction would render write affordances to someone the
 * server will refuse, which is a worse experience than hiding a button from
 * someone who could have used it.
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

/** Whether this role may perform writes. Reads are open to both. */
export function canWrite(role: LedgerRole): boolean {
  return role === "admin";
}
