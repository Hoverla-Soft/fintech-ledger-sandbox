import { describe, expect, it } from "vitest";

import { appRouter } from "./index";

/**
 * ADR 0005's central rule, enforced mechanically: **no procedure accepts an
 * organization identifier as input.**
 *
 * The acting org is derived from a verified `member` row in `orgProcedure`.
 * If any handler could also take one from its input, that derivation becomes
 * bypassable and every tenant-isolation guarantee in this package rests on
 * reviewers noticing. This test walks the real router and inspects the real
 * Zod schemas, so a new endpoint added in Phase 4b or later cannot
 * reintroduce the hole quietly.
 */

/** Field names that would let a caller name a tenant. */
const FORBIDDEN = ["orgid", "organizationid", "organisationid", "tenantid", "org", "organization"];

interface FoundProcedure {
  readonly path: string;
  readonly inputSchema: unknown;
}

/** Walks the router tree. A procedure is any node carrying oRPC's `~orpc` definition. */
function collectProcedures(node: unknown, path: readonly string[] = []): FoundProcedure[] {
  if (typeof node !== "object" || node === null) {
    return [];
  }

  if ("~orpc" in node) {
    const definition = (node as Record<string, unknown>)["~orpc"] as Record<string, unknown>;
    return [{ path: path.join("."), inputSchema: definition.inputSchema }];
  }

  return Object.entries(node).flatMap(([key, value]) => collectProcedures(value, [...path, key]));
}

/** Recursively collects every object key a Zod schema accepts. */
function collectKeys(schema: unknown, depth = 0): string[] {
  if (depth > 6 || typeof schema !== "object" || schema === null) {
    return [];
  }

  const candidate = schema as Record<string, unknown>;

  // Zod 4 exposes an object schema's fields on `.shape`; unwrap
  // optional/nullable/default wrappers via the inner type on `_def`.
  const inner = (candidate._def as Record<string, unknown> | undefined)?.innerType;
  const fromInner = inner === undefined ? [] : collectKeys(inner, depth + 1);

  const shape = candidate.shape;
  if (typeof shape !== "object" || shape === null) {
    return fromInner;
  }

  return [
    ...fromInner,
    ...Object.entries(shape).flatMap(([key, value]) => [key, ...collectKeys(value, depth + 1)]),
  ];
}

const procedures = collectProcedures(appRouter);

describe("ADR 0005: the acting org is derived, never accepted", () => {
  it("finds every procedure in the router", () => {
    // Guards the guard. If introspection silently returned nothing, every
    // assertion below would vacuously pass and this test would be worse than
    // useless — it would report green while checking nothing.
    expect(procedures.length).toBe(22);
    expect(procedures.map((procedure) => procedure.path).sort()).toEqual([
      "accounts.create",
      "accounts.get",
      "accounts.list",
      "accounts.postings",
      "approvals.approve",
      "approvals.listPending",
      "approvals.reject",
      "approvals.submitPending",
      "audit.list",
      "audit.rejections",
      "dashboard.summary",
      "healthCheck",
      "reconciliation.verify",
      "sandbox.reset",
      "sandbox.seed",
      "settings.get",
      "settings.setRequireTransferApproval",
      "transactions.create",
      "transactions.exchange",
      "transactions.get",
      "transactions.list",
      "transactions.reverse",
    ]);
  });

  it("can actually read the input schemas it claims to check", () => {
    // The second half of guarding the guard: prove `collectKeys` returns real
    // field names for a procedure known to take input, so a `[]` from a
    // future schema shape is recognisable as a broken check rather than a
    // clean bill of health.
    const accountsGet = procedures.find((procedure) => procedure.path === "accounts.get");

    expect(accountsGet).toBeDefined();
    expect(collectKeys(accountsGet?.inputSchema)).toContain("accountId");
  });

  it.each(procedures)("$path accepts no organization identifier", ({ inputSchema }) => {
    const keys = collectKeys(inputSchema).map((key) => key.toLowerCase());

    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
