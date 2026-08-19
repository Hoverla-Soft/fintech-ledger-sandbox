import { createContext, getDatabase } from "@fintech-ledger-sandbox/api/context";
import { appRouter } from "@fintech-ledger-sandbox/api/routers/index";
import { auth } from "@fintech-ledger-sandbox/auth";
import { env } from "@fintech-ledger-sandbox/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { logger, logUnexpectedError } from "./logger";

/**
 * The Hono app, separated from the process that serves it (`index.ts`).
 *
 * The split exists so this is *testable*. Until 2026-08-16 `apps/server` had no
 * test file and no Vitest config at all: everything lived beside a top-level
 * `serve()` call, so importing any of it started a real HTTP listener. The
 * on-the-wire suite in `packages/api/src/http.test.ts` works around that by
 * assembling its own Hono app that *mirrors* this one, and its docblock records
 * the cost — "`apps/server`'s own composition is not covered here". Response
 * headers are exactly the kind of thing a mirror cannot prove, because the
 * mirror does not have them.
 */

/**
 * The largest request body accepted, before any parsing.
 *
 * Zod validates `transactions.create` down to `MAX_POSTINGS` legs, but only
 * *after* the whole body has been buffered into memory — so without a limit
 * here, the bound in `packages/api` describes what is accepted, not what is
 * read. 1 MB is far above the largest legitimate request this API has (a
 * max-leg transaction is a few kilobytes of JSON) and far below a size that
 * matters to the process.
 */
const MAX_BODY_BYTES = 1_024 * 1_024;

const isProduction = env.NODE_ENV === "production";

/**
 * The only paths on this origin that serve HTML rather than JSON: the Scalar
 * reference UI and the spec it inlines.
 */
function isReferenceUi(path: string): boolean {
  return path === "/api-reference" || path.startsWith("/api-reference/");
}

/**
 * Headers a throttled client can act on without parsing the body.
 *
 * `packages/api`'s limiter already puts `limit` and `retryAfterSeconds` in
 * `data`, and the console reads them from there. What the body cannot reach is
 * *generic* retry machinery — an HTTP client, a proxy, a job runner — which
 * looks for `Retry-After` and otherwise backs off on a schedule of its own
 * invention, or not at all (ADR 0007 recorded exactly this consequence).
 *
 * Derived from the body rather than plumbed down from the limiter because the
 * limiter throws through oRPC, which owns response construction from there on.
 * Re-reading one small JSON body is the cheap way to stay outside that.
 *
 * Only a `429` is buffered. Every other response, which is all of them in any
 * normal minute, is passed through untouched and still streams.
 */
async function withRateLimitHeaders(response: Response): Promise<Response> {
  if (response.status !== 429) {
    return response;
  }

  const body = await response.text();
  const headers = new Headers(response.headers);

  try {
    const detail = (JSON.parse(body) as { data?: Record<string, unknown> }).data;

    if (typeof detail?.retryAfterSeconds === "number") {
      // Both, deliberately: `Retry-After` is the one every generic client
      // already knows, `RateLimit-Reset` the one the draft standard specifies.
      headers.set("Retry-After", String(detail.retryAfterSeconds));
      headers.set("RateLimit-Reset", String(detail.retryAfterSeconds));
    }
    if (typeof detail?.limit === "number") {
      headers.set("RateLimit-Limit", String(detail.limit));
    }
    // A 429 means the budget is spent by definition.
    headers.set("RateLimit-Remaining", "0");
  } catch {
    // A 429 whose body is not the expected JSON still has to reach the client.
    // Losing the advisory headers is survivable; turning a throttle into a 500
    // because a header could not be computed is not.
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Response headers a cross-origin caller is allowed to *read*.
 *
 * The console runs on a different origin, and a browser hides every response
 * header outside the CORS-safelisted set unless it is named here. Without this
 * the headers above would be present on the wire and invisible to the one
 * client that ships with this API.
 */
const RATE_LIMIT_HEADERS = [
  "Retry-After",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
];

export function createApp(): Hono {
  const app = new Hono();

  // Ordering is load-bearing, top to bottom:
  //
  // 1. `requestId` first, so every later middleware — including the error log —
  //    can correlate. This closes the other half of `error-handling.md`'s
  //    logging item, which recorded "correlation IDs are not yet emitted; they
  //    arrive with the structured logger".
  // 2. `secureHeaders` before the handlers, so headers are attached even to
  //    responses the oRPC handlers produce and to error responses.
  // 3. `cors` after the security headers but before any route, since a
  //    preflight must be answered without reaching a handler.
  // 4. `bodyLimit` last of the middlewares, so an over-sized body is refused
  //    before `createContext` runs a session lookup for it.
  app.use(requestId());

  /**
   * Request logging, replacing `hono/logger`.
   *
   * `hono/logger` wrote a human line to stdout with no request id and no
   * structure — fine for a terminal, useless to anything that parses. This
   * emits the same facts as one JSON object carrying the correlation id, so a
   * failure logged by `logUnexpectedError` can be tied to the request that
   * caused it.
   *
   * `debug` rather than `info`: one line per request at production level would
   * bury the events worth reading, and the level is `info` in production
   * precisely so this stays off there unless `LOG_LEVEL` asks for it.
   */
  app.use("*", async (c, next) => {
    const startedAt = performance.now();
    await next();
    logger.debug(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "request_completed",
    );
  });

  app.use(
    "*",
    secureHeaders({
      // Two policies from one registration.
      //
      // Almost everything this origin returns is JSON, which needs no
      // subresources at all — so it gets `default-src 'none'`, the strictest
      // policy there is. The exception is `/api-reference`: oRPC's
      // `OpenAPIReferencePlugin` renders the Scalar UI with a jsDelivr
      // `<script src>` *and* a second inline `<script>` carrying no nonce, so a
      // nonce-based policy cannot rescue it without replacing the plugin's
      // renderer. That one path gets exactly what it needs and nothing more.
      //
      // A **function element is evaluated per request**, which is what lets one
      // middleware serve both. The alternative — two `secureHeaders`
      // registrations on overlapping paths — is a trap: `secureHeaders` writes
      // its headers *after* `await next()`, so the first-registered instance
      // wins, which is the opposite of how route matching usually reads.
      contentSecurityPolicy: {
        defaultSrc: [
          (c) =>
            isReferenceUi(c.req.path)
              ? "'self' https://cdn.jsdelivr.net 'unsafe-inline' data:"
              : "'none'",
        ],
        // `font-src` *does* fall back to `default-src`, which is why this was
        // missed: the policy above looked complete and the page still rendered.
        // It rendered in a fallback system font. A live load of
        // `/api-reference` blocked 14 faces from `fonts.scalar.com` — the
        // Scalar bundle fetches its own webfonts from a host that appears
        // nowhere in the HTML the plugin emits, so reading the renderer (which
        // is how the jsDelivr entry was found) could not have surfaced it.
        // Only a browser could, which is the general lesson here: a CSP is not
        // verified until something has actually executed under it.
        //
        // Scoped to the reference UI and to fonts alone. Everything else on
        // this origin is JSON and keeps inheriting `'none'`.
        fontSrc: [
          (c) => (isReferenceUi(c.req.path) ? "'self' https://fonts.scalar.com data:" : "'none'"),
        ],
        // None of these fall back to `default-src`; they have to be spelled out.
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },

      // `DENY` rather than the `SAMEORIGIN` default: nothing here is ever meant
      // to be framed, including by itself.
      xFrameOptions: "DENY",

      // Asserted only over HTTPS. Locally this server is plain http on 3000;
      // browsers ignore HSTS on http, so setting it there is not dangerous, but
      // it is a header claiming something untrue, and the local Railway/preview
      // split is exactly where an untrue header gets copied into a real config.
      strictTransportSecurity: isProduction ? "max-age=31536000; includeSubDomains" : false,

      // The console is a *different origin* (3001 → 3000). Cross-origin
      // resource policy governs no-cors subresource loads, not credentialed
      // CORS fetches, so `same-origin` does not affect the oRPC client — but it
      // does stop this API's responses being pulled into another page as a
      // subresource.
      crossOriginResourcePolicy: "same-origin",
    }),
  );

  app.use(
    "/*",
    cors({
      origin: env.CORS_ORIGIN,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: RATE_LIMIT_HEADERS,
      credentials: true,
    }),
  );

  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES }));

  /**
   * Both probes are registered **before** the oRPC catch-all below, and that
   * ordering is the whole point.
   *
   * Hono runs handlers in registration order. `/` used to sit after
   * `app.use("/*")`, so every liveness probe first ran `createContext`, which
   * resolves a Better Auth session — a database round-trip. A liveness check
   * that fails when the database is down is not a liveness check; it tells a
   * supervisor to restart a process that is working perfectly, and restarting
   * cannot bring Postgres back. Registering here means `/` touches nothing.
   */
  app.get("/", (c) => c.text("OK"));

  /**
   * Readiness: can this process actually serve traffic.
   *
   * `/` returning a static string was the entire health surface until
   * 2026-08-16, which meant a deployment could report healthy while Postgres was
   * unreachable — every real request 500ing behind a green check.
   *
   * Uses the pool directly rather than `createContext`, so it measures the
   * database and not Better Auth. The failure body names no driver detail, per
   * the "error responses leak nothing" rule in
   * `docs/backend/error-handling.md`: a connection error can carry the host,
   * port, and user of the database.
   */
  app.get("/ready", async (c) => {
    try {
      await getDatabase().$client.query("SELECT 1");
      return c.json({ status: "ready" });
    } catch (error) {
      logger.error({ err: error, requestId: c.get("requestId") }, "readiness_check_failed");
      return c.json({ status: "unavailable" }, 503);
    }
  });

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Module-local, not exported. Nothing outside this file uses either handler,
  // and exporting them forced tsdown to emit their types into `index.d.ts` —
  // which reaches for `LedgerSession` from `packages/api`'s *source* path and
  // resolves to nothing, since internal packages export `.ts` rather than a
  // built `.d.ts` (ADR 0001). `apps/server` is an application entry point, not
  // a library; it has no public surface to declare.
  const apiHandler = new OpenAPIHandler(appRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
    ],
    interceptors: [onError(logUnexpectedError)],
  });

  const rpcHandler = new RPCHandler(appRouter, {
    interceptors: [onError(logUnexpectedError)],
  });

  app.use("/*", async (c, next) => {
    const context = await createContext({ context: c });

    const rpcResult = await rpcHandler.handle(c.req.raw, {
      prefix: "/rpc",
      context: context,
    });

    if (rpcResult.matched) {
      const response = await withRateLimitHeaders(rpcResult.response);
      return c.newResponse(response.body, response);
    }

    const apiResult = await apiHandler.handle(c.req.raw, {
      prefix: "/api-reference",
      context: context,
    });

    if (apiResult.matched) {
      const response = await withRateLimitHeaders(apiResult.response);
      return c.newResponse(response.body, response);
    }

    await next();
  });

  return app;
}
