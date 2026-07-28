import { describe, expect, it } from "vitest";

import { describeFailure, keepsFormOpen, type LedgerReason } from "@/lib/ledger/errors";

import { toFieldErrors } from "./field-errors";

function orpcError(code: string, status: number, data: Record<string, unknown> = {}) {
  return { code, status, message: "A fixed server string the console must never render.", data };
}

/**
 * The create dialog's routing logic, tested without a DOM.
 *
 * Which field a server rejection lands on is the difference between a user
 * fixing their input in place and a user staring at a closed form wondering
 * what happened. It is worth asserting directly rather than only through a
 * rendered dialog.
 */
describe("toFieldErrors", () => {
  it("puts a duplicate-name conflict on the name field", () => {
    // The case the whole dialog is shaped around: 409 is fixable by typing a
    // different name, so it must land on that field with the form still open.
    const failure = describeFailure(orpcError("CONFLICT", 409, { reason: "account_name_taken" }));
    expect(toFieldErrors(failure).name).toBeTruthy();
    expect(toFieldErrors(failure).currency).toBeUndefined();
    expect(keepsFormOpen(failure)).toBe(true);
  });

  it("puts an unsupported currency on the currency field", () => {
    const failure = describeFailure(
      orpcError("UNPROCESSABLE_CONTENT", 422, { reason: "unsupported_currency" }),
    );
    expect(toFieldErrors(failure).currency).toBeTruthy();
    expect(toFieldErrors(failure).name).toBeUndefined();
  });

  it("maps Zod issues onto their own fields", () => {
    const failure = describeFailure(
      orpcError("BAD_REQUEST", 400, {
        issues: [
          { path: ["name"], message: "Too long" },
          { path: ["currency"], message: "Required" },
        ],
      }),
    );
    const errors = toFieldErrors(failure);
    expect(errors.name).toBe("Too long");
    expect(errors.currency).toBe("Required");
  });

  it("ignores issue paths that are not fields on this form", () => {
    const failure = describeFailure(
      orpcError("BAD_REQUEST", 400, { issues: [{ path: ["orgId"], message: "nope" }] }),
    );
    expect(toFieldErrors(failure)).toEqual({});
  });

  it("attaches nothing for failures the form cannot fix", () => {
    // insufficient_role closes the dialog and toasts; pinning it to a field
    // would tell the user to edit their way out of a permissions problem.
    for (const reason of ["insufficient_role", "not_a_member"] as LedgerReason[]) {
      const failure = describeFailure(orpcError("FORBIDDEN", 403, { reason }));
      expect(toFieldErrors(failure)).toEqual({});
      expect(keepsFormOpen(failure)).toBe(false);
    }
  });

  it("keeps the form open for a throttled submit without pinning it to a field", () => {
    const failure = describeFailure(
      orpcError("TOO_MANY_REQUESTS", 429, { reason: "rate_limited", retryAfterSeconds: 9 }),
    );
    expect(toFieldErrors(failure)).toEqual({});
    // The user did nothing wrong and the condition clears in seconds —
    // discarding what they typed would be gratuitous.
    expect(keepsFormOpen(failure)).toBe(true);
    expect(failure.rateLimit?.retryAfterSeconds).toBe(9);
  });

  it("never surfaces the server's raw message on any branch", () => {
    for (const reason of ["account_name_taken", "unsupported_currency", "insufficient_role"] as LedgerReason[]) {
      const failure = describeFailure(orpcError("CONFLICT", 409, { reason }));
      const errors = toFieldErrors(failure);
      for (const value of Object.values(errors)) {
        expect(value).not.toContain("fixed server string");
      }
    }
  });
});
