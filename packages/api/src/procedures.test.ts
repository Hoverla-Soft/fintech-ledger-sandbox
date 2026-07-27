import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { ORPCError } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { Db } from "@fintech-ledger-sandbox/db";

import { clientFor, seedOrphanUser, seedTenant, sessionFor } from "./test/fixtures";

/**
 * The procedure ladder's rejection paths — the checks that run *before* any
 * repository query, and therefore before any org-scoped data could be read.
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

describe("publicProcedure", () => {
  it("serves an unauthenticated caller", async () => {
    await expect(clientFor(db, null).healthCheck({})).resolves.toBe("OK");
  });
});

describe("protectedProcedure", () => {
  it("rejects a request with no session as 401", async () => {
    const error = await captureError(() => clientFor(db, null).privateData({}));

    expect(error.status).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
  });
});

describe("orgProcedure", () => {
  it("rejects a request with no session as 401, before any org lookup", async () => {
    const error = await captureError(() => clientFor(db, null).accounts.list({}));

    expect(error.status).toBe(401);
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a signed-in session with no active organization as 403", async () => {
    const orphanId = await seedOrphanUser(db);
    const error = await captureError(() =>
      clientFor(db, { userId: orphanId, activeOrganizationId: null }).accounts.list({}),
    );

    expect(error.status).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.data).toEqual({ reason: "no_active_organization" });
  });

  it("rejects a session naming an organization the user has no member row for", async () => {
    const tenant = await seedTenant(db, "Real");
    const orphanId = await seedOrphanUser(db);

    const error = await captureError(() =>
      clientFor(db, { userId: orphanId, activeOrganizationId: tenant.orgId }).accounts.list({}),
    );

    expect(error.status).toBe(403);
    expect(error.data).toEqual({ reason: "not_a_member" });
  });

  it("uses 403 rather than 404 for both org failures, so neither reveals whether the org exists", async () => {
    const orphanId = await seedOrphanUser(db);
    const realTenant = await seedTenant(db, "Real");

    const nonexistentOrg = await captureError(() =>
      clientFor(db, { userId: orphanId, activeOrganizationId: "00000000-0000-0000-0000-000000000000" }).accounts.list({}),
    );
    const realButForeignOrg = await captureError(() =>
      clientFor(db, { userId: orphanId, activeOrganizationId: realTenant.orgId }).accounts.list({}),
    );

    // A 404 for the first and 403 for the second would be an existence
    // oracle for organizations.
    expect(nonexistentOrg.status).toBe(403);
    expect(realButForeignOrg.status).toBe(403);
    expect(nonexistentOrg.code).toBe(realButForeignOrg.code);
    expect(nonexistentOrg.data).toEqual(realButForeignOrg.data);
  });

  it("admits a genuine member and scopes the read to their org", async () => {
    const tenant = await seedTenant(db, "Member");
    await expect(clientFor(db, sessionFor(tenant)).accounts.list({})).resolves.toEqual({ accounts: [] });
  });
});

describe("role mapping through the middleware", () => {
  // The mapping itself is unit-tested in `auth/roles.test.ts`. What matters
  // here is that the raw Better Auth string in `member.role` actually reaches
  // it, rather than being read from somewhere else or defaulted.
  it("admits a viewer to the read surface", async () => {
    const tenant = await seedTenant(db, "Viewer", "member");
    await expect(clientFor(db, sessionFor(tenant)).accounts.list({})).resolves.toEqual({ accounts: [] });
  });

  it("admits an admin to the read surface", async () => {
    const tenant = await seedTenant(db, "Admin", "admin");
    await expect(clientFor(db, sessionFor(tenant)).accounts.list({})).resolves.toEqual({ accounts: [] });
  });
});
