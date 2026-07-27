/**
 * A discriminated-union result type for construction-time validation.
 *
 * `packages/core` never throws for expected domain-rule violations (bad
 * currency, unbalanced transaction, insufficient funds, ...). Every fallible
 * constructor/factory returns a `Result` instead, so callers must handle the
 * error path explicitly and TypeScript narrows on the `ok` discriminant.
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Internal-only assertion helper — not re-exported from `index.ts`.
 *
 * Unwraps a `Result` that is provably `ok` given invariants already checked
 * by the caller (e.g. currency agreement confirmed immediately before an
 * arithmetic call whose only failure mode is a currency mismatch). An
 * *expected* domain-rule violation always stays a typed `Result`; this is
 * only for the narrow case where a value object's constructor is private
 * and the only way to rebuild it is through its own fallible public
 * factory, even though the inputs were already validated one level up.
 */
export function unwrapInvariant<T, E>(result: Result<T, E>, invariant: string): T {
  if (!result.ok) {
    throw new Error(`Ledger invariant violated: ${invariant}`);
  }
  return result.value;
}
