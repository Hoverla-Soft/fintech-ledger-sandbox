export interface WireAuditEntry {
  readonly id: string;
  readonly actorUserId: string;
  /** An open string, NOT an enum. `packages/api` may record an action this console has never seen. */
  readonly action: string;
  readonly outcome: "posted" | "rejected";
  /** An open string too — a published reason, or something new. */
  readonly reason: string | null;
  readonly transactionId: string | null;
  /** `z.unknown()` on the wire. Nothing may be assumed about its shape. */
  readonly metadata: unknown;
  readonly createdAt: string;
}

/**
 * Rendering helpers for the audit log.
 *
 * Everything here exists because three of `auditEntrySchema`'s fields are
 * deliberately open, and treating them as closed is how a log viewer breaks on
 * exactly the rows most worth reading.
 */

/**
 * Known actions, purely for nicer wording. Never exhaustive, never a `switch`.
 *
 * A `Map` rather than an object literal, and the reason is not style. `action`
 * is an untrusted open string, and a plain-object lookup inherits from
 * `Object.prototype`: `labels["__proto__"]` returns an *object*, and
 * `labels["toString"]` returns a *function*, so the `??` fallback never fires
 * and the cell renders `[object Object]`. `packages/core`'s currency parser
 * guards the identical hazard with `Object.hasOwn`; a `Map` has no prototype
 * chain to fall through in the first place.
 */
const ACTION_LABELS = new Map<string, string>([
  ["post_transaction", "Posted a transaction"],
  ["reverse_transaction", "Reversed a transaction"],
  ["create_account", "Created an account"],
]);

/**
 * A human label for an action, falling back to the raw value.
 *
 * The fallback is the point. `action` is `z.string()` and a future phase can
 * record something new; a `switch` with no default would render a blank cell
 * for precisely the novel entries an operator most needs to see. Showing the
 * raw identifier is worse-looking and strictly more informative than showing
 * nothing.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS.get(action) ?? action;
}

/**
 * Formats `metadata` for display without assuming anything about it.
 *
 * Handles `null`, `undefined`, primitives, arrays, objects, and values that
 * cannot be serialized at all (a circular structure would make `JSON.stringify`
 * throw — inside a table cell, that takes down the whole log).
 */
export function formatMetadata(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) {
    return null;
  }
  if (typeof metadata === "string") {
    return metadata;
  }
  if (
    typeof metadata === "number" ||
    typeof metadata === "boolean" ||
    typeof metadata === "bigint"
  ) {
    return String(metadata);
  }
  try {
    const rendered = JSON.stringify(metadata, null, 2);
    // `JSON.stringify` returns `undefined` for a function or a symbol rather
    // than throwing, which would otherwise render the string "undefined".
    return rendered ?? null;
  } catch {
    return "(metadata could not be displayed)";
  }
}

/**
 * Whether an entry is a refusal the sandbox *intends* to produce.
 *
 * The seed set includes a transfer that must be rejected, and replaying a run
 * appends another identical rejection each time (`docs/adr/0008-sandbox-reset.md`).
 * Without this distinction a user seeing five identical refusals concludes
 * something retried five times in error.
 */
export function isExpectedRefusal(entry: WireAuditEntry): boolean {
  return entry.outcome === "rejected" && entry.reason === "insufficient_funds";
}
