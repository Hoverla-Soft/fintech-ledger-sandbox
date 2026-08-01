import { randomUUID } from "node:crypto";
import type { Db } from "@fintech-ledger-sandbox/db";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { ORPCError } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { resetRateLimitersForTesting } from "../rate-limit";
import {
  clientFor,
  type SeededTenant,
  seedAccount,
  seedMemberIn,
  seedTenant,
  sessionFor,
} from "../test/fixtures";

/**
 * Thin maker-checker: submit pending → second admin approve/reject.
 * Balances must not move until approve.
 */

let db: Db;
let reset: () => Promise<void>;
let admin: SeededTenant;
let funding: string;
let wallet: string;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  resetRateLimitersForTesting();

  admin = await seedTenant(db, "Approvals", "admin");
  funding = await seedAccount(db, admin.orgId, "external", "Funding");
  wallet = await seedAccount(db, admin.orgId, "normal", "Wallet");
});

function asAdmin() {
  return clientFor(db, sessionFor(admin));
}

function transfer(amount: string, key = randomUUID()) {
  return {
    idempotencyKey: key,
    postings: [
      { accountId: wallet, direction: "debit" as const, amount, currency: "USD" },
      { accountId: funding, direction: "credit" as const, amount, currency: "USD" },
    ],
  };
}

async function captureError(run: () => Promise<unknown>): Promise<ORPCError<string, any>> {
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

describe("approvals", () => {
  it("lists a submitted pending transfer without moving balances", async () => {
    const pending = await asAdmin().approvals.submitPending(transfer("25.00"));
    expect(pending.status).toBe("pending");
    expect(pending.replayed).toBe(false);

    const listed = await asAdmin().approvals.listPending({});
    expect(listed.pending).toHaveLength(1);
    expect(listed.pending[0]?.id).toBe(pending.id);

    const { accounts } = await asAdmin().accounts.list({});
    const funded = accounts.find((account) => account.id === wallet);
    expect(funded?.balance.amount).toBe("0.00");
  });

  it("replays the same pending row under the same idempotency key", async () => {
    const key = randomUUID();
    const first = await asAdmin().approvals.submitPending(transfer("10.00", key));
    const second = await asAdmin().approvals.submitPending(transfer("10.00", key));
    expect(second.id).toBe(first.id);
    expect(second.replayed).toBe(true);

    const listed = await asAdmin().approvals.listPending({});
    expect(listed.pending).toHaveLength(1);
  });

  it("forbids the submitter from approving or rejecting their own request", async () => {
    const pending = await asAdmin().approvals.submitPending(transfer("5.00"));

    const selfApprove = await captureError(() =>
      asAdmin().approvals.approve({
        pendingId: pending.id,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(selfApprove.code).toBe("FORBIDDEN");
    expect(selfApprove.data).toMatchObject({ reason: "self_approve_forbidden" });

    const selfReject = await captureError(() =>
      asAdmin().approvals.reject({ pendingId: pending.id }),
    );
    expect(selfReject.code).toBe("FORBIDDEN");
    expect(selfReject.data).toMatchObject({ reason: "self_approve_forbidden" });
  });

  it("lets a different admin approve and posts the transfer once", async () => {
    const pending = await asAdmin().approvals.submitPending(transfer("40.00"));
    const approverId = await seedMemberIn(db, admin.orgId, "admin");
    const approver = clientFor(db, sessionFor({ orgId: admin.orgId, userId: approverId }));

    const posted = await approver.approvals.approve({
      pendingId: pending.id,
      idempotencyKey: randomUUID(),
    });
    expect(posted.replayed).toBe(false);
    expect(posted.postings).toHaveLength(2);

    const listed = await asAdmin().approvals.listPending({});
    expect(listed.pending).toHaveLength(0);

    const { accounts } = await asAdmin().accounts.list({});
    const funded = accounts.find((account) => account.id === wallet);
    expect(funded?.balance.amount).toBe("40.00");
  });

  it("lets a different admin reject without posting", async () => {
    const pending = await asAdmin().approvals.submitPending(transfer("15.00"));
    const approverId = await seedMemberIn(db, admin.orgId, "admin");
    const approver = clientFor(db, sessionFor({ orgId: admin.orgId, userId: approverId }));

    const rejected = await approver.approvals.reject({ pendingId: pending.id });
    expect(rejected.status).toBe("rejected");

    const listed = await asAdmin().approvals.listPending({});
    expect(listed.pending).toHaveLength(0);

    const { accounts } = await asAdmin().accounts.list({});
    const funded = accounts.find((account) => account.id === wallet);
    expect(funded?.balance.amount).toBe("0.00");
  });

  it("refuses a viewer on submit and approve", async () => {
    const viewerId = await seedMemberIn(db, admin.orgId, "member");
    const viewer = clientFor(db, sessionFor({ orgId: admin.orgId, userId: viewerId }));

    const submit = await captureError(() => viewer.approvals.submitPending(transfer("1.00")));
    expect(submit.code).toBe("FORBIDDEN");

    const pending = await asAdmin().approvals.submitPending(transfer("1.00"));
    const approve = await captureError(() =>
      viewer.approvals.approve({
        pendingId: pending.id,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(approve.code).toBe("FORBIDDEN");
  });

  it("exposes and updates the org require-transfer-approval setting", async () => {
    const initial = await asAdmin().settings.get({});
    expect(initial.requireTransferApproval).toBe(false);

    const updated = await asAdmin().settings.setRequireTransferApproval({
      requireTransferApproval: true,
    });
    expect(updated.requireTransferApproval).toBe(true);
    expect((await asAdmin().settings.get({})).requireTransferApproval).toBe(true);
  });
});
