import type { Db } from "@fintech-ledger-sandbox/db";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { ORPCError } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { clientFor, seedMemberIn, seedTenant, sessionFor } from "../test/fixtures";

/**
 * `session.context` — what the server says the caller is.
 *
 * The point of these cases is that the answer comes from the same
 * `requireOrg` resolution every write is authorized by, so the console's hint
 * and the server's enforcement cannot disagree (open question #1).
 */

let db: Db;
let reset: () => Promise<void>;

beforeAll(() => {
  const database = connectTestDatabase(inject("dbTestConnectionString"));
  db = database.db;
  reset = database.reset;
});

beforeEach(async () => {
  await reset();
});

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

describe("session.context", () => {
  it("reports the caller's own id, org, and admin role", async () => {
    const admin = await seedTenant(db, "Context", "admin");

    const context = await clientFor(db, sessionFor(admin)).session.context({});

    expect(context).toEqual({
      userId: admin.userId,
      orgId: admin.orgId,
      role: "admin",
    });
  });

  it("maps a Better Auth `member` to viewer, and is readable by them", async () => {
    // Deliberately `orgProcedure`, not `adminProcedure`: refusing a viewer the
    // answer to "what am I" would leave the console unable to know it should
    // hide a write affordance — the problem this procedure exists to solve.
    const admin = await seedTenant(db, "Context", "admin");
    const viewerId = await seedMemberIn(db, admin.orgId, "member");

    const context = await clientFor(
      db,
      sessionFor({ orgId: admin.orgId, userId: viewerId }),
    ).session.context({});

    expect(context.role).toBe("viewer");
    expect(context.userId).toBe(viewerId);
  });

  it("maps a Better Auth `owner` to admin", async () => {
    const owner = await seedTenant(db, "Context", "owner");

    expect((await clientFor(db, sessionFor(owner)).session.context({})).role).toBe("admin");
  });

  it("refuses a session naming an organization the caller does not belong to", async () => {
    // Same 403 every other org-scoped read gives. This procedure must not
    // become a way to probe which org ids exist.
    const admin = await seedTenant(db, "Context", "admin");
    const outsider = await seedTenant(db, "Other", "admin");

    const refused = await captureError(() =>
      clientFor(db, sessionFor({ orgId: admin.orgId, userId: outsider.userId })).session.context(
        {},
      ),
    );

    expect(refused.code).toBe("FORBIDDEN");
  });

  it("refuses a session with no active organization", async () => {
    const admin = await seedTenant(db, "Context", "admin");

    const refused = await captureError(() =>
      clientFor(db, { userId: admin.userId, activeOrganizationId: null }).session.context({}),
    );

    expect(refused.code).toBe("FORBIDDEN");
  });
});
