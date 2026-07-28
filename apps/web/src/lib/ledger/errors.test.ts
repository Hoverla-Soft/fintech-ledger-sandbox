import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeFailure,
  keepsFormOpen,
  LEDGER_REASONS,
  type LedgerReason,
  requiresNewIdempotencyKey,
} from "./errors";

/** Walks up from the working directory to the pnpm workspace root, so this test is start-directory independent. */
function findRepoRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`Could not locate the workspace root from ${process.cwd()}`);
}

/** Every `.ts` file under a directory, recursively, excluding test files. */
function collectTypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptSources(path);
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      return [path];
    }
    return [];
  });
}

/** Shapes an oRPC error the way the client library surfaces it. */
function orpcError(code: string, status: number, data: Record<string, unknown> = {}): unknown {
  return { code, status, message: "A fixed server string the console must never render.", data };
}

describe("reason coverage", () => {
  it("has copy for all 17 published reasons", () => {
    expect(LEDGER_REASONS).toHaveLength(17);
    for (const reason of LEDGER_REASONS) {
      const described = describeFailure(orpcError("UNPROCESSABLE_CONTENT", 422, { reason }));
      expect(described.reason).toBe(reason);
      expect(described.title.length).toBeGreaterThan(0);
      expect(described.detail.length).toBeGreaterThan(0);
    }
  });

  it("matches the reasons packages/api can actually emit", () => {
    // Read the API's own source and extract every `reason: "..."` literal.
    // This is the check that catches an 18th reason being added upstream:
    // without it, a new reason would fall silently through to the generic
    // fallback in production and nothing would ever say so.
    // `import.meta.url` is an `http://` URL under happy-dom, so the repo root
    // is found by walking up for the workspace manifest. Anchoring on
    // `process.cwd()` alone would break: it is the Vitest *root* under
    // `pnpm --filter web test`, but the *repo root* under a run started from
    // the top level, which `vitest.config.ts`'s `apps/*` project glob allows.
    const apiSrc = resolve(findRepoRoot(), "packages/api/src");

    // Every file under packages/api/src that can throw, not a hand-picked
    // three. `invalid_cursor` is emitted from `routers/transactions.ts`, so a
    // fixed list of top-level files misses it — and would equally miss a new
    // reason introduced in any future router.
    const sources = collectTypeScriptSources(apiSrc)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const emitted = new Set(
      [...sources.matchAll(/reason:\s*"([a-z_]+)"/g)].map((match) => match[1] as LedgerReason),
    );

    // Guards the guard: if the walk ever stops finding real source, the set
    // would be empty and the loop below would pass over nothing. Pinned to the
    // full published count so a *narrowing* of the scan is caught too.
    expect(emitted.size).toBe(LEDGER_REASONS.length);
    expect(emitted).toContain("invalid_cursor");

    // Everything the API emits must have console copy.
    for (const reason of emitted) {
      expect(LEDGER_REASONS).toContain(reason);
    }
  });
});

describe("describeFailure — reasoned failures", () => {
  it("never renders the server's own message", () => {
    for (const reason of LEDGER_REASONS) {
      const described = describeFailure(orpcError("UNPROCESSABLE_CONTENT", 422, { reason }));
      // `message` is a fixed, leak-proof string written for an operator, not
      // a user, and it is explicitly not a stable contract
      // (docs/backend/error-handling.md:17-18).
      expect(described.title).not.toContain("fixed server string");
      expect(described.detail).not.toContain("fixed server string");
    }
  });

  it("never implies another tenant's row exists", () => {
    for (const reason of ["account_not_found", "transaction_not_found"] as const) {
      const described = describeFailure(orpcError("NOT_FOUND", 404, { reason }));
      // "belongs to another organization" would be an existence oracle.
      expect(described.detail.toLowerCase()).toContain("this organization");
      expect(described.detail.toLowerCase()).not.toContain("another organization");
    }
  });

  it("keeps the form open for failures the user can fix, and not for the others", () => {
    const fixable: LedgerReason[] = [
      "insufficient_funds",
      "invalid_amount",
      "currency_mismatch",
      "unbalanced_transaction",
      "account_name_taken",
    ];
    for (const reason of fixable) {
      expect(keepsFormOpen(describeFailure(orpcError("UNPROCESSABLE_CONTENT", 422, { reason })))).toBe(true);
    }

    const notFixable: LedgerReason[] = ["insufficient_role", "not_a_member", "idempotency_conflict"];
    for (const reason of notFixable) {
      expect(keepsFormOpen(describeFailure(orpcError("FORBIDDEN", 403, { reason })))).toBe(false);
    }
  });

  it("keeps the form open on a transient failure too — a throttled submit must not discard the input", () => {
    // The user did nothing wrong, the operation did not happen, and the
    // condition clears in seconds. Closing the form would throw away
    // everything they typed.
    expect(keepsFormOpen(describeFailure(orpcError("TOO_MANY_REQUESTS", 429, { reason: "rate_limited" })))).toBe(
      true,
    );
    // And an unmapped failure, which may be a dropped connection mid-submit.
    expect(keepsFormOpen(describeFailure(orpcError("INTERNAL_SERVER_ERROR", 500)))).toBe(true);
  });

  it("routes session and membership failures to re-authentication, not to an error screen", () => {
    // docs/product/roles-and-permissions/ledger.md:70 — a user with no active
    // org is the normal state after sign-up, and the console routes them to
    // org creation rather than treating it as an error.
    for (const reason of ["no_active_organization", "not_a_member"] as const) {
      expect(describeFailure(orpcError("FORBIDDEN", 403, { reason })).disposition).toBe("reauthenticate");
    }
  });

  it("abandons the idempotency key only on a conflict", () => {
    expect(
      requiresNewIdempotencyKey(describeFailure(orpcError("CONFLICT", 409, { reason: "idempotency_conflict" }))),
    ).toBe(true);

    // Critically NOT on insufficient_funds: the user fixes the amount and
    // resubmits under the same key, which the server treats as one operation.
    // A fresh key here would post twice (ADR 0006:17).
    expect(
      requiresNewIdempotencyKey(
        describeFailure(orpcError("UNPROCESSABLE_CONTENT", 422, { reason: "insufficient_funds" })),
      ),
    ).toBe(false);

    for (const reason of LEDGER_REASONS.filter((candidate) => candidate !== "idempotency_conflict")) {
      expect(requiresNewIdempotencyKey(describeFailure(orpcError("UNPROCESSABLE_CONTENT", 422, { reason })))).toBe(
        false,
      );
    }
  });

  it("surfaces the rate-limit detail from the body, since there is no Retry-After header", () => {
    const described = describeFailure(
      orpcError("TOO_MANY_REQUESTS", 429, {
        reason: "rate_limited",
        scope: "organization",
        limit: 60,
        retryAfterSeconds: 12,
      }),
    );
    expect(described.rateLimit).toEqual({ scope: "organization", limit: 60, retryAfterSeconds: 12 });
  });

  it("tolerates a rate-limit body missing its optional fields", () => {
    const described = describeFailure(orpcError("TOO_MANY_REQUESTS", 429, { reason: "rate_limited" }));
    expect(described.rateLimit).toEqual({ scope: undefined, limit: undefined, retryAfterSeconds: undefined });
  });
});

describe("describeFailure — the three branches that carry no reason", () => {
  it("handles a bare 401", () => {
    const described = describeFailure(orpcError("UNAUTHORIZED", 401));
    expect(described.reason).toBeNull();
    expect(described.disposition).toBe("reauthenticate");
  });

  it("handles a Zod BAD_REQUEST and exposes the field issues", () => {
    const described = describeFailure(
      orpcError("BAD_REQUEST", 400, {
        issues: [
          { path: ["postings", 0, "amount"], message: "Too long" },
          { path: ["idempotencyKey"], message: "Required" },
        ],
      }),
    );
    expect(described.reason).toBeNull();
    expect(described.disposition).toBe("fix_input");
    expect(described.issues).toEqual([
      { path: ["postings", 0, "amount"], message: "Too long" },
      { path: ["idempotencyKey"], message: "Required" },
    ]);
  });

  it("handles an unmapped 500 without rendering internals", () => {
    const described = describeFailure(orpcError("INTERNAL_SERVER_ERROR", 500));
    expect(described.reason).toBeNull();
    expect(described.title).toBe("Something went wrong");
  });
});

describe("describeFailure — hostile and non-oRPC input", () => {
  it("falls back rather than rendering undefined for an unrecognised reason", () => {
    const described = describeFailure(orpcError("UNPROCESSABLE_CONTENT", 422, { reason: "reason_from_the_future" }));
    expect(described.reason).toBeNull();
    expect(described.title).toBe("Something went wrong");
    expect(described.detail).not.toContain("undefined");
  });

  it.each([
    ["a network TypeError", new TypeError("Failed to fetch")],
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "boom"],
    ["a number", 42],
    ["an empty object", {}],
    ["data as a string", { code: "X", status: 500, data: "not-an-object" }],
    ["issues as a non-array", { code: "BAD_REQUEST", status: 400, data: { issues: "nope" } }],
  ])("returns renderable copy for %s", (_label, thrown) => {
    const described = describeFailure(thrown);
    expect(typeof described.title).toBe("string");
    expect(described.title.length).toBeGreaterThan(0);
    expect(Array.isArray(described.issues)).toBe(true);
  });

  it("drops malformed issue entries instead of throwing inside the error handler", () => {
    const described = describeFailure(
      orpcError("BAD_REQUEST", 400, {
        issues: [null, 7, { message: "kept" }, { path: ["a"], message: "also kept" }, { path: ["b"] }],
      }),
    );
    expect(described.issues).toEqual([
      { path: [], message: "kept" },
      { path: ["a"], message: "also kept" },
    ]);
  });
});
