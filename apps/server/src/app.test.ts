import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { createApp } from "./app";
import { REDACTED_PATHS } from "./logger";

/**
 * Proof for the four ⚠️ rows in `docs/showcase/security.md` that this slice
 * converts. That file's "Proven by" column is the reason these exist: a control
 * whose evidence column reads `manual` is a claim, and security headers are
 * exactly the kind of claim that silently stops being true when middleware is
 * reordered.
 */

describe("security response headers", () => {
  it("sets the headers that matter on a JSON API", async () => {
    const response = await createApp().request("/");

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("removes the framework fingerprint", async () => {
    const response = await createApp().request("/");

    expect(response.headers.get("x-powered-by")).toBeNull();
  });

  it("does not assert HSTS outside production", async () => {
    // The header claims "only ever reach me over HTTPS". Sending it from a
    // plain-http dev server is a lie a browser happens to ignore — and the kind
    // of lie that gets copied into a real config.
    const response = await createApp().request("/");

    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("locks the JSON surface down to default-src 'none'", async () => {
    const csp = (await createApp().request("/")).headers.get("content-security-policy");

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("relaxes the policy only on the reference UI, and only as far as it needs", async () => {
    // The docs page is the one HTML surface here: oRPC renders it with a
    // jsDelivr <script src> plus a nonce-less inline <script>. If this ever
    // reports `'none'`, /api-reference renders blank.
    const csp = (await createApp().request("/api-reference")).headers.get(
      "content-security-policy",
    );

    expect(csp).toContain("https://cdn.jsdelivr.net");
    expect(csp).toContain("'unsafe-inline'");
    // The relaxation must not follow the page off its own path.
    expect(csp).not.toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("health probes", () => {
  it("answers liveness without touching the database", async () => {
    // The database in this suite is unreachable by construction (see
    // vitest.config.ts). If `/` still answers 200, it genuinely has no
    // dependency — which is the whole reason it is registered before the oRPC
    // catch-all that resolves a session.
    const response = await createApp().request("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  it("reports unavailable from /ready when the database is gone", async () => {
    const response = await createApp().request("/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("leaks no connection detail in the readiness failure body", async () => {
    // A pg connection error carries host, port, user, and database name.
    const body = await (await createApp().request("/ready")).text();

    expect(body).not.toContain("127.0.0.1");
    expect(body).not.toContain("postgres");
    expect(body).not.toContain("password");
  });
});

describe("request body limit", () => {
  it("refuses a body larger than the cap before parsing it", async () => {
    const response = await createApp().request("/rpc/transactions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(1_024 * 1_024 + 1),
    });

    expect(response.status).toBe(413);
  });
});

describe("log redaction", () => {
  /**
   * Closes `docs/backend/error-handling.md`'s open item "secret and
   * sensitive-data redaction has an automated test", which was blocked on there
   * being no structured logger to redact through.
   *
   * Asserts against the exact `REDACTED_PATHS` the real logger is built with,
   * writing to a captured stream rather than the process's stdout.
   */
  function captureLog(payload: Record<string, unknown>): string {
    let written = "";
    const log = pino(
      { redact: { paths: REDACTED_PATHS, censor: "[redacted]" } },
      { write: (chunk: string) => (written += chunk) },
    );
    log.error(payload, "test_event");
    return written;
  }

  it("hides a session cookie", () => {
    const output = captureLog({
      req: { headers: { cookie: "better-auth.session_token=super-secret-value" } },
    });

    expect(output).not.toContain("super-secret-value");
    expect(output).toContain("[redacted]");
  });

  it("hides an authorization header", () => {
    const output = captureLog({
      req: { headers: { authorization: "Bearer super-secret-token" } },
    });

    expect(output).not.toContain("super-secret-token");
  });

  it("hides the bound parameters of a failed database query", () => {
    // The non-obvious one. `DrizzleQueryError` carries `query` and `params` as
    // own enumerable properties and pino's default `err` serializer emits every
    // one of them — so before these paths existed, any failing statement logged
    // its bound values. Better Auth's Drizzle adapter binds session tokens and
    // password hashes, which makes this the most likely real leak in the list.
    class DrizzleQueryError extends Error {
      query: string;
      params: unknown[];
      constructor(query: string, params: unknown[]) {
        super("Failed query");
        this.query = query;
        this.params = params;
      }
    }

    const output = captureLog({
      err: new DrizzleQueryError("insert into session (token) values ($1)", [
        "leaked-session-token",
      ]),
    });

    expect(output).not.toContain("leaked-session-token");
  });

  it("hides a connection string and the auth secret", () => {
    const output = captureLog({
      DATABASE_URL: "postgresql://postgres:hunter2@db.internal:5432/ledger",
      BETTER_AUTH_SECRET: "another-secret-at-least-32-characters-long",
    });

    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("another-secret-at-least-32-characters-long");
  });
});
