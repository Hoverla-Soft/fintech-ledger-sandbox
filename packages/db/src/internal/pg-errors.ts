/**
 * Recovering Postgres SQLSTATE codes from wrapped driver errors.
 *
 * Internal to `packages/db` — not in the public export map. Extracted in
 * Phase 4b so `posting/reserve-key.ts` (idempotency key collisions) and
 * `repositories/accounts.ts` (duplicate account names) share **one**
 * definition. Both need to distinguish "this specific constraint was
 * violated" from "the database failed", and ADR 0004 already records this
 * unwrap as a real Phase 3 bug and a known fragility against a drizzle-orm
 * upgrade. A second copy would mean a future upgrade could fix one call site
 * and silently leave the other mislabelling errors.
 */

/** Unique constraint violation. */
export const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Walks the `cause` chain to find a Postgres SQLSTATE code.
 *
 * drizzle-orm wraps every driver error in its own `DrizzleQueryError`, whose
 * `cause` is the raw `pg` `DatabaseError` that actually carries `.code` — a
 * plain `"code" in error` check on the error a caller catches would never
 * match, because that `code` lives one level deeper. Bounded depth guards
 * against an unexpected circular `cause` chain.
 */
export function getPostgresErrorCode(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if ("cause" in error) {
    return getPostgresErrorCode((error as { cause: unknown }).cause, depth + 1);
  }
  return undefined;
}

/** Whether an error is a Postgres unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION;
}
