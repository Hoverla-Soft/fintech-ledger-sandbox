import type { DescribedFailure } from "@/lib/ledger/errors";

/**
 * Routes a server failure onto the form field that caused it.
 *
 * Split out of the dialog because *which field a rejection lands on* is the
 * difference between a user fixing their input in place and a user staring at
 * a closed form wondering what happened — a decision worth testing directly
 * rather than only through a rendered component.
 *
 * An empty result means "this is not a field problem": either the form cannot
 * fix it (`insufficient_role`) or it is not about any one input
 * (`rate_limited`). Callers use `keepsFormOpen` to decide what to do then.
 */
export interface FieldErrors {
  name?: string;
  currency?: string;
  type?: string;
}

const FORM_FIELDS = new Set(["name", "currency", "type"]);

export function toFieldErrors(failure: DescribedFailure): FieldErrors {
  // `409 account_name_taken` is the case the create dialog is shaped around:
  // fixable by typing a different name, so it belongs on the name field with
  // the form still open — never a toast over a closed form.
  if (failure.reason === "account_name_taken") {
    return { name: failure.detail };
  }
  if (failure.reason === "unsupported_currency") {
    return { currency: failure.detail };
  }

  // Zod rejections arrive as a path/message list (`400 {issues}`). Attach each
  // to its own field rather than rendering a generic "check your input".
  const fromIssues: FieldErrors = {};
  for (const issue of failure.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && FORM_FIELDS.has(field)) {
      fromIssues[field as keyof FieldErrors] = issue.message;
    }
  }
  return fromIssues;
}
