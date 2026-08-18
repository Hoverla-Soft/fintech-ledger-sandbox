import { randomUUID } from "node:crypto";
import type { Db } from "@fintech-ledger-sandbox/db";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import {
  clientFor,
  postTransfer,
  type SeededTenant,
  seedAccount,
  seedTenant,
  sessionFor,
} from "../test/fixtures";

/**
 * Paging behaviour for the four reads that gained a cursor in Phase 7a
 * (`docs/open-questions.md` #6 and #7). `transactions.list` was already
 * paginated and is covered in `reads.test.ts`.
 *
 * The properties worth pinning are not "a cursor comes back". They are:
 *
 * - a walk visits **every** row exactly once — no duplicate, no gap;
 * - a bad cursor is a `400`, never an empty page, because an empty page tells
 *   someone their ledger is empty when it is not;
 * - `reconciliation.verify`'s verdict covers the whole org, not the page.
 *   That last one is the reason this file exists.
 */

let db: Db;
let reset: () => Promise<void>;
let tenant: SeededTenant;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
  tenant = await seedTenant(db, "Paging");
});

function client() {
  return clientFor(db, sessionFor(tenant));
}

/**
 * Walks a paginated procedure to exhaustion and returns every id it yielded,
 * in order.
 *
 * Deliberately bounded: a cursor bug that fails to advance produces an
 * infinite walk, and a test that hangs is far worse to diagnose than one that
 * fails. The guard trips well above any page count these fixtures produce.
 */
async function walkAll(
  fetchPage: (cursor: string | null) => Promise<{ ids: string[]; nextCursor: string | null }>,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const { ids, nextCursor } = await fetchPage(cursor);
    seen.push(...ids);
    if (nextCursor === null) {
      return seen;
    }
    cursor = nextCursor;
  }
  throw new Error("cursor walk did not terminate within 50 pages — the cursor is not advancing");
}

/** Names that sort predictably, so "outside the first page" is a fact rather than a hope. */
const ACCOUNT_NAMES = ["A One", "B Two", "C Three", "D Four", "E Five", "F Six"] as const;

async function seedSixAccounts(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const name of ACCOUNT_NAMES) {
    byName.set(name, await seedAccount(db, tenant.orgId, "external", name));
  }
  return byName;
}

describe("accounts.list pagination (open question #7)", () => {
  it("returns a cursor when more rows remain, and null on the last page", async () => {
    await seedSixAccounts();

    const first = await client().accounts.list({ limit: 4 });
    expect(first.accounts).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();

    const second = await client().accounts.list({ limit: 4, cursor: first.nextCursor ?? "" });
    expect(second.accounts).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("walks every account exactly once across pages, in name order", async () => {
    await seedSixAccounts();

    const walked = await walkAll(async (cursor) => {
      const page = await client().accounts.list({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.accounts.map((account) => account.name), nextCursor: page.nextCursor };
    });

    expect(walked).toEqual([...ACCOUNT_NAMES]);
    expect(new Set(walked).size).toBe(ACCOUNT_NAMES.length);
  });

  it("pages stably across accounts created in the same millisecond", async () => {
    // The `(name, id)` tiebreaker exists for this. Account rows inserted in a
    // tight loop can share a `created_at`; the sort key here is `name`, so what
    // this really proves is that a walk cannot skip or repeat a row when the
    // keys are adjacent.
    await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        seedAccount(db, tenant.orgId, "external", `Bulk ${String(index).padStart(2, "0")}`),
      ),
    );

    const walked = await walkAll(async (cursor) => {
      const page = await client().accounts.list({
        limit: 3,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.accounts.map((account) => account.id), nextCursor: page.nextCursor };
    });

    expect(walked).toHaveLength(10);
    expect(new Set(walked).size).toBe(10);
  });
});

describe("audit pagination (open question #6)", () => {
  /** Each successful transfer writes exactly one `posted` audit entry. */
  async function postTransfers(count: number): Promise<void> {
    const funding = await seedAccount(db, tenant.orgId, "external", "Funding");
    const wallet = await seedAccount(db, tenant.orgId, "normal", "Wallet");
    for (let index = 0; index < count; index += 1) {
      await postTransfer(db, tenant, funding, wallet, "1.00");
    }
  }

  it("walks the whole log exactly once, most recent first", async () => {
    await postTransfers(5);

    const walked = await walkAll(async (cursor) => {
      const page = await client().audit.list({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.entries.map((entry) => entry.id), nextCursor: page.nextCursor };
    });

    expect(walked).toHaveLength(5);
    expect(new Set(walked).size).toBe(5);

    // Descending by `createdAt`. A cursor built for an ascending walk would
    // return page one forever, which `walkAll`'s page guard would catch — but
    // this asserts the *order* the log is actually in.
    const all = await client().audit.list({ limit: 200 });
    const timestamps = all.entries.map((entry) => Date.parse(entry.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
  });

  it("is no longer capped at 200 — the log is walkable past the old ceiling", async () => {
    // Open question #6 was specifically that the log "is not walkable past its
    // most recent 200". Proving that with 201 real transfers would be slow, so
    // this proves the mechanism instead: a full walk at the maximum page size
    // reaches a null cursor, and every page past the first is reachable.
    await postTransfers(7);

    const first = await client().audit.list({ limit: 3 });
    expect(first.nextCursor).not.toBeNull();

    const walked = await walkAll(async (cursor) => {
      const page = await client().audit.list({
        limit: 3,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.entries.map((entry) => entry.id), nextCursor: page.nextCursor };
    });
    expect(walked).toHaveLength(7);
  });

  it("pages the rejections view independently of the full log", async () => {
    // `rejections` is a filtered read of the same table. Its cursor must walk
    // the filtered sequence, not the unfiltered one — a cursor taken from the
    // full log and applied to the filtered view would skip rejections.
    const emptySource = await seedAccount(db, tenant.orgId, "normal", "Empty");
    const target = await seedAccount(db, tenant.orgId, "normal", "Target");
    await postTransfers(3);

    for (let index = 0; index < 4; index += 1) {
      // Overdraws a `normal` account, which invariant #6 forbids — a `422`
      // that also writes a rejection audit row, which is what this pages over.
      await expect(
        client().transactions.create({
          idempotencyKey: randomUUID(),
          postings: [
            { accountId: target, direction: "debit", amount: "50.00", currency: "USD" },
            { accountId: emptySource, direction: "credit", amount: "50.00", currency: "USD" },
          ],
        }),
      ).rejects.toMatchObject({ status: 422 });
    }

    const walked = await walkAll(async (cursor) => {
      const page = await client().audit.rejections({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.entries.map((entry) => entry.id), nextCursor: page.nextCursor };
    });

    expect(walked).toHaveLength(4);
    expect(new Set(walked).size).toBe(4);

    const rejections = await client().audit.rejections({ limit: 200 });
    for (const entry of rejections.entries) {
      expect(entry.outcome).toBe("rejected");
    }
  });
});

describe("reconciliation.verify pagination (open question #7)", () => {
  /**
   * Breaks invariant #2 for one account by writing a balance that disagrees
   * with its postings.
   *
   * Raw SQL on purpose: there is deliberately no way to do this through the
   * ledger's own write path — that is the whole point of the invariant — and
   * `schema/ledger` is not in `packages/db`'s export map, which CLAUDE.md
   * forbids reaching around. Drift has to be injected at the storage layer or
   * it cannot be tested at all.
   */
  async function driftBalance(accountId: string): Promise<void> {
    await db.execute(
      sql`update ledger_account set balance = balance + 1 where id = ${accountId} and org_id = ${tenant.orgId}`,
    );
  }

  it("reports every account across pages, in name order", async () => {
    await seedSixAccounts();

    const walked = await walkAll(async (cursor) => {
      const page = await client().reconciliation.verify({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.accounts.map((row) => row.accountName), nextCursor: page.nextCursor };
    });

    expect(walked).toEqual([...ACCOUNT_NAMES]);
  });

  it("reports allReconciled: false when the only drifting account is outside the first page", async () => {
    // The load-bearing test of this whole task. `allReconciled` computed as a
    // fold over the returned rows would be `true` here — every account on page
    // one is clean — and a reconciliation endpoint that answers "yes" while
    // drift sits on a later page is worse than one that does not exist, because
    // someone will trust it.
    const byName = await seedSixAccounts();
    const lastByName = byName.get("F Six");
    expect(lastByName).toBeDefined();
    if (lastByName === undefined) {
      return;
    }
    await driftBalance(lastByName);

    const firstPage = await client().reconciliation.verify({ limit: 2 });

    // Page one is genuinely clean...
    expect(firstPage.accounts).toHaveLength(2);
    for (const row of firstPage.accounts) {
      expect(row.reconciled).toBe(true);
    }
    // ...and the verdict still says no.
    expect(firstPage.allReconciled).toBe(false);
    expect(firstPage.unreconciledCount).toBe(1);
    expect(firstPage.accountCount).toBe(ACCOUNT_NAMES.length);
  });

  it("counts every account whole-org regardless of page size", async () => {
    await seedSixAccounts();

    const small = await client().reconciliation.verify({ limit: 1 });
    const large = await client().reconciliation.verify({ limit: 200 });

    expect(small.accountCount).toBe(ACCOUNT_NAMES.length);
    expect(large.accountCount).toBe(ACCOUNT_NAMES.length);
    expect(small.allReconciled).toBe(true);
    expect(large.allReconciled).toBe(true);
    expect(small.accounts).toHaveLength(1);
  });

  it("counts a posting-less account as reconciled at zero rather than excusing it", async () => {
    // `coalesce(computed, 0) <> recorded` matters: comparing `NULL <> 0` is
    // `NULL`, which `count(*) filter` does not count — so a freshly created
    // account with a non-zero balance and no postings would be silently
    // excused by the very check meant to catch it.
    const fresh = await seedAccount(db, tenant.orgId, "normal", "No Postings");

    expect((await client().reconciliation.verify({})).allReconciled).toBe(true);

    await driftBalance(fresh);

    const after = await client().reconciliation.verify({});
    expect(after.allReconciled).toBe(false);
    expect(after.unreconciledCount).toBe(1);
  });
});

describe("approvals.listPending pagination (open question #29)", () => {
  /**
   * Submits `count` transfers into the maker-checker queue.
   *
   * Through the real `submitPending` rather than hand-inserted rows: the point
   * of #29 is that the *queue* was unwalkable, and a queue filled by anything
   * other than the production submit path is not the queue.
   */
  async function submitPending(count: number): Promise<string[]> {
    const funding = await seedAccount(db, tenant.orgId, "external", "Queue Funding");
    const wallet = await seedAccount(db, tenant.orgId, "normal", "Queue Wallet");
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const submitted = await client().approvals.submitPending({
        idempotencyKey: randomUUID(),
        postings: [
          { accountId: wallet, direction: "debit", amount: "1.00", currency: "USD" },
          { accountId: funding, direction: "credit", amount: "1.00", currency: "USD" },
        ],
      });
      ids.push(submitted.id);
    }
    return ids;
  }

  it("walks the whole queue exactly once, past the old 100-row ceiling", async () => {
    // `listPendingTransfers` was `.limit(100)` with no cursor, so the 101st
    // submission was not on page two — it was invisible. Proving that with 101
    // real submissions would be slow; what actually has to hold is that a walk
    // terminates having seen every row, at a page size smaller than the queue.
    const submitted = await submitPending(6);

    const walked = await walkAll(async (cursor) => {
      const page = await client().approvals.listPending({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      return { ids: page.pending.map((row) => row.id), nextCursor: page.nextCursor };
    });

    expect(walked).toHaveLength(submitted.length);
    expect(new Set(walked).size).toBe(submitted.length);
    expect(new Set(walked)).toEqual(new Set(submitted));
  });

  it("orders oldest first, so the longest-waiting submission is on page one", async () => {
    // The direction is load-bearing and is the opposite of the audit log's.
    // An approvals queue is FIFO: newest-first would bury the submission that
    // has waited longest under everything submitted since.
    //
    // Asserted as strictly increasing on the composite `(createdAt, id)` sort
    // key rather than on submission order. Six inserts in a tight loop can
    // share a millisecond, and then submission order is decided by the `id`
    // tiebreaker — so comparing against the submitted sequence would flake.
    // This is the ordering contract itself, and it is never trivially true.
    await submitPending(6);

    const rows: { createdAt: number; id: string }[] = [];
    await walkAll(async (cursor) => {
      const page = await client().approvals.listPending({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      for (const row of page.pending) {
        rows.push({ createdAt: Date.parse(row.createdAt), id: row.id });
      }
      return { ids: page.pending.map((row) => row.id), nextCursor: page.nextCursor };
    });

    expect(rows).toHaveLength(6);
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous === undefined || current === undefined) {
        continue;
      }
      const ascending =
        current.createdAt > previous.createdAt ||
        (current.createdAt === previous.createdAt && current.id > previous.id);
      expect(ascending).toBe(true);
    }
  });

  it("returns a cursor while rows remain and null on the last page", async () => {
    await submitPending(5);

    const first = await client().approvals.listPending({ limit: 3 });
    expect(first.pending).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await client().approvals.listPending({
      limit: 3,
      cursor: first.nextCursor ?? "",
    });
    expect(second.pending).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});

describe("every paginated procedure rejects a malformed cursor identically", () => {
  // One `reason` code across all six, because the console keys its "that page
  // link expired, here is page one" recovery off it. A procedure that spelled
  // it differently would silently render an empty list instead — and on
  // `approvals.listPending` an empty list reads as "nothing is waiting on you".
  const badCursor = "!!!not-a-cursor!!!";

  it.each([
    ["accounts.list", (cursor: string) => client().accounts.list({ cursor })],
    ["audit.list", (cursor: string) => client().audit.list({ cursor })],
    ["audit.rejections", (cursor: string) => client().audit.rejections({ cursor })],
    ["reconciliation.verify", (cursor: string) => client().reconciliation.verify({ cursor })],
    ["transactions.list", (cursor: string) => client().transactions.list({ cursor })],
    ["approvals.listPending", (cursor: string) => client().approvals.listPending({ cursor })],
  ])("%s returns 400 invalid_cursor, not an empty page", async (_label, call) => {
    await expect(call(badCursor)).rejects.toMatchObject({
      status: 400,
      data: { reason: "invalid_cursor" },
    });
  });

  it.each([
    ["accounts.list", (limit: number) => client().accounts.list({ limit })],
    ["audit.list", (limit: number) => client().audit.list({ limit })],
    ["audit.rejections", (limit: number) => client().audit.rejections({ limit })],
    ["reconciliation.verify", (limit: number) => client().reconciliation.verify({ limit })],
    ["approvals.listPending", (limit: number) => client().approvals.listPending({ limit })],
  ])("%s rejects an out-of-range limit at the contract boundary", async (_label, call) => {
    await expect(call(0)).rejects.toMatchObject({ status: 400 });
    await expect(call(10_000)).rejects.toMatchObject({ status: 400 });
  });
});
