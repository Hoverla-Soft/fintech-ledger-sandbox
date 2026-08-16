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

async function captureError(
  run: () => Promise<unknown>,
): Promise<ORPCError<string, Record<string, unknown>>> {
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
      }),
    );
    expect(approve.code).toBe("FORBIDDEN");
  });

  it("refuses a direct post when the org requires approval, and audits the attempt", async () => {
    // The whole point of #25: before this, the flag constrained the console and
    // nothing else, so an admin with curl walked straight past the queue.
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: true });

    const refused = await captureError(() => asAdmin().transactions.create(transfer("10.00")));

    expect(refused.code).toBe("FORBIDDEN");
    expect(refused.data.reason).toBe("approval_required");

    // Nothing moved.
    const { accounts } = await asAdmin().accounts.list({});
    for (const account of accounts) {
      expect(account.balance.amount).toBe("0.00");
    }

    // And the bypass attempt is on the record, like every other refusal.
    const rejections = await asAdmin().audit.rejections({});
    expect(rejections.entries.some((entry) => entry.reason === "approval_required")).toBe(true);
  });

  it("refuses an exchange when the org requires approval — it has no approval route", async () => {
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: true });

    const refused = await captureError(() =>
      asAdmin().transactions.exchange({
        idempotencyKey: randomUUID(),
        fromAccountId: wallet,
        toAccountId: funding,
        amount: "10.00",
        rate: "0.92",
        targetAmount: "9.20",
      }),
    );

    expect(refused.code).toBe("FORBIDDEN");
    expect(refused.data.reason).toBe("approval_required");
  });

  it("leaves the direct post untouched when the flag is off", async () => {
    // The gate must be inert by default — the flag ships off, and every other
    // test in this repo posts directly.
    const posted = await asAdmin().transactions.create(transfer("10.00"));
    expect(posted.replayed).toBe(false);
  });

  it("still posts through approve while the flag is on", async () => {
    // The trap this guards: `approvals.approve` posts via `postTransaction`,
    // not via `transactions.create`. If it ever routes through the wire
    // procedure, the new gate turns every approval into a 403 and nothing in
    // the org can ever be approved again.
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: true });

    const pending = await asAdmin().approvals.submitPending(transfer("10.00"));
    const approverId = await seedMemberIn(db, admin.orgId, "admin");
    const approver = clientFor(db, sessionFor({ orgId: admin.orgId, userId: approverId }));

    const posted = await approver.approvals.approve({ pendingId: pending.id });
    expect(posted.replayed).toBe(false);
  });

  it("posts once when the same pending transfer is approved twice", async () => {
    // #26. The old signature took a caller-supplied idempotency key and the
    // console minted a fresh uuid per click, so a double-click posted twice and
    // orphaned the second transaction. The key is now derived from the pending
    // row, so the second approve replays instead.
    const pending = await asAdmin().approvals.submitPending(transfer("10.00"));
    const approverId = await seedMemberIn(db, admin.orgId, "admin");
    const approver = clientFor(db, sessionFor({ orgId: admin.orgId, userId: approverId }));

    const first = await approver.approvals.approve({ pendingId: pending.id });
    expect(first.replayed).toBe(false);

    const second = await captureError(() => approver.approvals.approve({ pendingId: pending.id }));
    // `NOT_FOUND`, not `CONFLICT`: the handler's first check is
    // `status !== "pending"`, so a decided row reads as absent. That is
    // pre-existing behaviour and not what this test is about — what matters is
    // the assertion below.
    expect(second.code).toBe("NOT_FOUND");

    const listed = await approver.transactions.list({});
    expect(listed.transactions).toHaveLength(1);
  });

  it("posts once when two admins approve the same transfer concurrently", async () => {
    // The race the status check cannot catch: both callers read the row before
    // either writes. Only the derived idempotency key stops the double post.
    const pending = await asAdmin().approvals.submitPending(transfer("10.00"));
    const oneId = await seedMemberIn(db, admin.orgId, "admin");
    const twoId = await seedMemberIn(db, admin.orgId, "admin");
    const one = clientFor(db, sessionFor({ orgId: admin.orgId, userId: oneId }));
    const two = clientFor(db, sessionFor({ orgId: admin.orgId, userId: twoId }));

    await Promise.allSettled([
      one.approvals.approve({ pendingId: pending.id }),
      two.approvals.approve({ pendingId: pending.id }),
    ]);

    const listed = await asAdmin().transactions.list({});
    expect(listed.transactions).toHaveLength(1);

    // And the money moved exactly once — a debit raises this account, so a
    // second posting would read 20.00.
    const { accounts } = await asAdmin().accounts.list({});
    const walletRow = accounts.find((account) => account.id === wallet);
    expect(walletRow?.balance.amount).toBe("10.00");
  });

  it("refuses reverse, seed, and reset too — every direct balance change is gated", async () => {
    // All three were proven bypasses before `directPostProcedure` existed, and
    // all three were *omissions* rather than decisions: the gate used to be a
    // helper each handler had to remember to call.
    //
    //  - reverse: reversing a reversal is permitted, so one admin drove an
    //    account 100 → 0 → 100 → 0 → 100 with four calls, no second approver.
    //  - seed: the funding scenario credits a normal account from an external
    //    one; two runs took an account 1500 → 3000. A value faucet.
    //  - reset: drove every account in the org to zero — the most destructive
    //    balance change the API offers.
    const posted = await asAdmin().transactions.create(transfer("10.00"));
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: true });

    const reversed = await captureError(() =>
      asAdmin().transactions.reverse({
        idempotencyKey: randomUUID(),
        transactionId: posted.id,
      }),
    );
    expect(reversed.data.reason).toBe("approval_required");

    const seeded = await captureError(() =>
      asAdmin().sandbox.seed({ idempotencyKey: randomUUID() }),
    );
    expect(seeded.data.reason).toBe("approval_required");

    const wiped = await captureError(() =>
      asAdmin().sandbox.reset({ idempotencyKey: randomUUID() }),
    );
    expect(wiped.data.reason).toBe("approval_required");

    // The balance from before the flag went on is untouched by all three.
    const { accounts } = await asAdmin().accounts.list({});
    expect(accounts.find((account) => account.id === wallet)?.balance.amount).toBe("10.00");
  });

  it("records who disabled the approval control, so flip-post-flip is visible", async () => {
    // Turning the control off is an admin's right; doing it invisibly is not.
    // Before this, flip-off → post → flip-on left a single ordinary
    // `post_transaction` row — indistinguishable from a posting in an org that
    // never required approval, in an org whose settings now say it does.
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: true });
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: false });
    await asAdmin().transactions.create(transfer("77.00"));
    await asAdmin().settings.setRequireTransferApproval({ requireTransferApproval: true });

    const { entries } = await asAdmin().audit.list({ limit: 200 });
    const toggles = entries.filter((entry) => entry.action === "set_require_transfer_approval");

    expect(toggles).toHaveLength(3);
    expect(toggles.some((entry) => entry.reason === "approval_control_disabled")).toBe(true);
    expect(toggles.some((entry) => entry.reason === "approval_control_enabled")).toBe(true);

    // And it stays out of the "what was refused" view, which is a different question.
    const { entries: rejections } = await asAdmin().audit.rejections({ limit: 200 });
    expect(rejections.some((entry) => entry.action === "set_require_transfer_approval")).toBe(
      false,
    );
  });

  it("refuses a caller-supplied key in the server's reserved namespace", async () => {
    // Denial-of-approval, closed by reserving the `approve:` prefix.
    //
    // A reservation is decided by (org_id, key) plus a request hash, and a
    // *different* hash under the same key is a permanent `IdempotencyConflict`
    // that nothing ever clears. `listPending` hands every admin the pending
    // ids, so without this an admin could post an ordinary transfer under the
    // key `approve:<someone else's pendingId>` and that transfer could never be
    // approved — no race, no timing, just a button that stops working forever.
    const pending = await asAdmin().approvals.submitPending(transfer("5.00"));

    const preburn = await captureError(() =>
      asAdmin().transactions.create({
        idempotencyKey: `approve:${pending.id}`,
        postings: transfer("1.00").postings,
      }),
    );
    expect(preburn.code).toBe("BAD_REQUEST");

    // And the approval it was aimed at still works.
    const approverId = await seedMemberIn(db, admin.orgId, "admin");
    const approver = clientFor(db, sessionFor({ orgId: admin.orgId, userId: approverId }));
    const posted = await approver.approvals.approve({ pendingId: pending.id });
    expect(posted.replayed).toBe(false);
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
