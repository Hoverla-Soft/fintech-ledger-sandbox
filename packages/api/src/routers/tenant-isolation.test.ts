import { randomUUID } from "node:crypto";

import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { ORPCError } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { Db } from "@fintech-ledger-sandbox/db";

import { clientFor, postTransfer, seedAccount, seedTenant, sessionFor, type SeededTenant } from "../test/fixtures";

/**
 * Invariant #5 — no read ever crosses an org boundary — asserted at the API
 * boundary, through the real middleware, the real repositories, and real
 * `org_id`-filtered SQL against a real Postgres.
 *
 * `packages/db` already proves its repositories filter by `org_id`. That is
 * not the same claim as this one. What is tested here is that the API layer
 * *derives* the right `orgId` and passes it down — a handler that read the
 * org from its input, or a middleware that trusted `activeOrganizationId`
 * without verifying membership, would leave every repository test passing
 * while leaking data. This suite is what makes ADR 0005 real rather than
 * aspirational.
 *
 * The shape is a matrix: two fully-populated orgs, then every one of the
 * seven read procedures called as org A, asserting it sees all of A and none
 * of B.
 */

let db: Db;
let reset: () => Promise<void>;

let orgA: SeededTenant;
let orgB: SeededTenant;
let orgAAccountId: string;
let orgBAccountId: string;
let orgATransactionId: string;
let orgBTransactionId: string;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();

  orgA = await seedTenant(db, "OrgA");
  orgB = await seedTenant(db, "OrgB");

  // Each org gets a funded external account and a normal account, then a real
  // posted transfer between them — so every read surface has data on both
  // sides of the boundary. Identical names on purpose: a query that leaked
  // would surface a same-named row and could otherwise look plausible.
  const orgAExternal = await seedAccount(db, orgA.orgId, "external", "Funding");
  orgAAccountId = await seedAccount(db, orgA.orgId, "normal", "Shared Name");
  orgATransactionId = await postTransfer(db, orgA, orgAExternal, orgAAccountId, "100.00");

  const orgBExternal = await seedAccount(db, orgB.orgId, "external", "Funding");
  orgBAccountId = await seedAccount(db, orgB.orgId, "normal", "Shared Name");
  orgBTransactionId = await postTransfer(db, orgB, orgBExternal, orgBAccountId, "250.00");
});

function asOrgA() {
  return clientFor(db, sessionFor(orgA));
}

/** Runs a call expected to fail and returns the `ORPCError` it threw. */
async function captureError(run: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

describe("accounts.list", () => {
  it("returns only the acting org's accounts", async () => {
    const { accounts } = await asOrgA().accounts.list({});

    const ids = accounts.map((account) => account.id);

    // Org A has exactly the two accounts seeded for it. Org B has two of its
    // own with identical names, so a leak would show up as a length of 4 —
    // or, if only one leaked, as a foreign id in this list.
    expect(accounts).toHaveLength(2);
    expect(ids).toContain(orgAAccountId);
    expect(ids).not.toContain(orgBAccountId);
  });

  it("never emits orgId, even though every repository row carries it", async () => {
    const { accounts } = await asOrgA().accounts.list({});

    for (const account of accounts) {
      expect(account).not.toHaveProperty("orgId");
    }
  });
});

describe("accounts.get", () => {
  it("returns the acting org's own account", async () => {
    const account = await asOrgA().accounts.get({ accountId: orgAAccountId });
    expect(account.id).toBe(orgAAccountId);
  });

  it("reports another org's account as 404, byte-identical to a missing one", async () => {
    // The core of the isolation contract: a caller must not be able to tell
    // "exists elsewhere" from "does not exist". Any difference in code,
    // status, message, or data is an existence oracle for another tenant.
    const crossOrg = await captureError(() => asOrgA().accounts.get({ accountId: orgBAccountId }));
    const missing = await captureError(() => asOrgA().accounts.get({ accountId: randomUUID() }));

    expect(crossOrg.status).toBe(404);
    expect(crossOrg.code).toBe("NOT_FOUND");
    expect(crossOrg.code).toBe(missing.code);
    expect(crossOrg.status).toBe(missing.status);
    expect(crossOrg.message).toBe(missing.message);
    expect(crossOrg.data).toEqual(missing.data);
  });

  it("does not echo the probed id back in the error", async () => {
    const error = await captureError(() => asOrgA().accounts.get({ accountId: orgBAccountId }));
    expect(JSON.stringify(error.toJSON())).not.toContain(orgBAccountId);
  });
});

describe("transactions.list", () => {
  it("returns only the acting org's transactions", async () => {
    const { transactions } = await asOrgA().transactions.list({});

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.id).toBe(orgATransactionId);
  });

  it("never emits orgId", async () => {
    const { transactions } = await asOrgA().transactions.list({});
    for (const transaction of transactions) {
      expect(transaction).not.toHaveProperty("orgId");
    }
  });
});

describe("transactions.get", () => {
  it("returns the acting org's transaction with its postings", async () => {
    const transaction = await asOrgA().transactions.get({ transactionId: orgATransactionId });

    expect(transaction.id).toBe(orgATransactionId);
    expect(transaction.postings).toHaveLength(2);
  });

  it("reports another org's transaction as 404, identical to a missing one", async () => {
    const crossOrg = await captureError(() => asOrgA().transactions.get({ transactionId: orgBTransactionId }));
    const missing = await captureError(() => asOrgA().transactions.get({ transactionId: randomUUID() }));

    expect(crossOrg.status).toBe(404);
    expect(crossOrg.code).toBe(missing.code);
    expect(crossOrg.message).toBe(missing.message);
    expect(crossOrg.data).toEqual(missing.data);
  });

  it("never leaks another org's postings", async () => {
    const transaction = await asOrgA().transactions.get({ transactionId: orgATransactionId });
    const accountIds = transaction.postings.map((posting) => posting.accountId);

    expect(accountIds).not.toContain(orgBAccountId);
  });
});

describe("reconciliation.verify", () => {
  it("reconciles only the acting org's accounts", async () => {
    const result = await asOrgA().reconciliation.verify({});

    expect(result.accounts).toHaveLength(2);
    expect(result.accounts.map((account) => account.accountId)).not.toContain(orgBAccountId);
    expect(result.allReconciled).toBe(true);
  });
});

describe("audit.list", () => {
  it("returns only the acting org's audit entries", async () => {
    const { entries } = await asOrgA().audit.list({});

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.transactionId !== orgBTransactionId)).toBe(true);
    expect(entries.some((entry) => entry.transactionId === orgATransactionId)).toBe(true);
  });

  it("never emits orgId", async () => {
    const { entries } = await asOrgA().audit.list({});
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("orgId");
    }
  });
});

describe("audit.rejections", () => {
  it("is scoped to the acting org and returns only rejected outcomes", async () => {
    const { entries } = await asOrgA().audit.rejections({});

    // Both orgs' transfers succeeded, so there is nothing to see — the
    // meaningful assertion is that the filter is applied and no cross-org row
    // appears regardless.
    expect(entries.every((entry) => entry.outcome === "rejected")).toBe(true);
    expect(entries.every((entry) => entry.transactionId !== orgBTransactionId)).toBe(true);
  });
});

describe("the acting org comes from membership, not from the session's claim", () => {
  it("refuses a session claiming an org the user is not a member of", async () => {
    // The forged-claim case. `activeOrganizationId` is caller-influenced
    // state; without the membership check in `orgProcedure` this would read
    // org B's accounts using org A's user.
    const forged = clientFor(db, { userId: orgA.userId, activeOrganizationId: orgB.orgId });
    const error = await captureError(() => forged.accounts.list({}));

    expect(error.status).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.data).toEqual({ reason: "not_a_member" });
  });

  it("scopes reads to whichever org the caller genuinely belongs to", async () => {
    const asB = clientFor(db, sessionFor(orgB));
    const { accounts } = await asB.accounts.list({});

    expect(accounts.map((account) => account.id)).toContain(orgBAccountId);
    expect(accounts.map((account) => account.id)).not.toContain(orgAAccountId);
  });
});
