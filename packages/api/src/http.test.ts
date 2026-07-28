import { randomUUID } from "node:crypto";
import type { Db } from "@fintech-ledger-sandbox/db";
import { connectTestDatabase } from "@fintech-ledger-sandbox/db/testing";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { Context, LedgerSession } from "./context";
import { resetRateLimitersForTesting } from "./rate-limit";
import { appRouter } from "./routers/index";
import {
  type SeededTenant,
  seedAccount,
  seedOrphanUser,
  seedTenant,
  sessionFor,
} from "./test/fixtures";

/**
 * The thin HTTP slice.
 *
 * Everything else in this suite calls the router in-process, which exercises
 * middleware and repositories but stops short of the handler that turns an
 * `ORPCError` into an HTTP response. Error mapping is a Phase 4a deliverable,
 * so the claim "a cross-org read is a 404" has to be checked where it is
 * actually observable — on the wire.
 *
 * **What this deliberately does not cover:** Better Auth. The app below is
 * assembled with a stub context rather than real session cookies, because the
 * thing under test is oRPC's status translation, not authentication. Wiring
 * signup/signin into every case would make these tests slow and would mostly
 * re-test a third-party library. The cost is that `apps/server`'s own
 * composition of `createContext` is not covered here; that wiring is a dozen
 * lines and unchanged in shape by this phase.
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
  resetRateLimitersForTesting();
});

/**
 * Builds a real Hono app serving the real router over HTTP, with the session
 * fixed up front. Mirrors `apps/server`'s mounting of `OpenAPIHandler`.
 */
function appWithSession(session: LedgerSession | null): Hono {
  const handler = new OpenAPIHandler(appRouter);
  const app = new Hono();

  app.use("/*", async (honoContext, next) => {
    const context: Context = { db, session };
    const result = await handler.handle(honoContext.req.raw, { prefix: "/api", context });

    if (result.matched) {
      return honoContext.newResponse(result.response.body, result.response);
    }

    await next();
  });

  return app;
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

describe("status codes on the wire", () => {
  it("returns 200 for a successful org-scoped read", async () => {
    const tenant = await seedTenant(db, "Http");
    await seedAccount(db, tenant.orgId, "normal", "Wallet");

    const response = await post(appWithSession(sessionFor(tenant)), "/accounts/list", {});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accounts: [expect.objectContaining({ name: "Wallet" })],
    });
  });

  it("returns 401 when there is no session", async () => {
    const response = await post(appWithSession(null), "/accounts/list", {});
    expect(response.status).toBe(401);
  });

  it("returns 403 when the session has no active organization", async () => {
    const orphanId = await seedOrphanUser(db);
    const response = await post(
      appWithSession({ userId: orphanId, activeOrganizationId: null }),
      "/accounts/list",
      {},
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      data: { reason: "no_active_organization" },
    });
  });

  it("returns 403 when the user is not a member of the claimed organization", async () => {
    const tenant = await seedTenant(db, "Real");
    const orphanId = await seedOrphanUser(db);

    const response = await post(
      appWithSession({ userId: orphanId, activeOrganizationId: tenant.orgId }),
      "/accounts/list",
      {},
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ data: { reason: "not_a_member" } });
  });

  it("returns 404 for an account in another organization", async () => {
    const orgA = await seedTenant(db, "OrgA");
    const orgB = await seedTenant(db, "OrgB");
    const orgBAccountId = await seedAccount(db, orgB.orgId, "normal", "Theirs");

    const response = await post(appWithSession(sessionFor(orgA)), "/accounts/get", {
      accountId: orgBAccountId,
    });

    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toMatchObject({ data: { reason: "account_not_found" } });
    // The response body must not confirm the probed id back to the caller.
    expect(JSON.stringify(body)).not.toContain(orgBAccountId);
  });

  it("returns an identical 404 body for a missing and a cross-org account", async () => {
    const orgA = await seedTenant(db, "OrgA");
    const orgB = await seedTenant(db, "OrgB");
    const orgBAccountId = await seedAccount(db, orgB.orgId, "normal", "Theirs");

    const app = appWithSession(sessionFor(orgA));
    const crossOrg = await post(app, "/accounts/get", { accountId: orgBAccountId });
    const missing = await post(app, "/accounts/get", { accountId: randomUUID() });

    expect(crossOrg.status).toBe(missing.status);
    expect(await crossOrg.json()).toEqual(await missing.json());
  });

  it("returns 400 for input that fails contract validation", async () => {
    const tenant: SeededTenant = await seedTenant(db, "Http");

    const response = await post(appWithSession(sessionFor(tenant)), "/accounts/get", {
      accountId: "not-a-uuid",
    });

    expect(response.status).toBe(400);
  });

  it("returns 409 on the wire for a duplicate account name", async () => {
    // Phase 4a verified 409/422 mapping by unit-testing `toORPCError` and by
    // reading oRPC's status table. These three cases are the first time those
    // statuses are observed on an actual HTTP response.
    const tenant = await seedTenant(db, "Http", "admin");
    const app = appWithSession(sessionFor(tenant));

    await post(app, "/accounts/create", { name: "Dup", currency: "USD", type: "normal" });
    const response = await post(app, "/accounts/create", {
      name: "Dup",
      currency: "USD",
      type: "normal",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      data: { reason: "account_name_taken" },
    });
  });

  it("returns 422 on the wire for an unbalanced transaction", async () => {
    const tenant = await seedTenant(db, "Http", "admin");
    const app = appWithSession(sessionFor(tenant));
    const a = await seedAccount(db, tenant.orgId, "external", "A");
    const b = await seedAccount(db, tenant.orgId, "normal", "B");

    const response = await post(app, "/transactions/create", {
      idempotencyKey: randomUUID(),
      postings: [
        { accountId: b, direction: "debit", amount: "100.00", currency: "USD" },
        { accountId: a, direction: "credit", amount: "99.00", currency: "USD" },
      ],
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      data: { reason: "unbalanced_transaction" },
    });
  });

  it("returns 429 on the wire once the write limit is exhausted", async () => {
    const tenant = await seedTenant(db, "Limited", "admin");
    const app = appWithSession(sessionFor(tenant));

    let limited: Response | undefined;
    for (let i = 0; i < 70; i += 1) {
      const response = await post(app, "/accounts/create", {
        name: `Acct ${i}`,
        currency: "USD",
        type: "normal",
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).toBeDefined();
    await expect(limited?.json()).resolves.toMatchObject({ data: { reason: "rate_limited" } });
  });

  it("returns 403 on the wire when a viewer attempts a write", async () => {
    const viewer = await seedTenant(db, "Viewer", "member");
    const response = await post(appWithSession(sessionFor(viewer)), "/accounts/create", {
      name: "Nope",
      currency: "USD",
      type: "normal",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ data: { reason: "insufficient_role" } });
  });

  it("serves the public health check without a session", async () => {
    // oRPC derives the OpenAPI path from the procedure's key verbatim — no
    // kebab-casing — so this is `/healthCheck`, not `/health-check`.
    const response = await post(appWithSession(null), "/healthCheck", {});
    expect(response.status).toBe(200);
  });
});
