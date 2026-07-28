import { createContext } from "@fintech-ledger-sandbox/api/context";
import { appRouter } from "@fintech-ledger-sandbox/api/routers/index";
import { auth } from "@fintech-ledger-sandbox/auth";
import { env } from "@fintech-ledger-sandbox/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

/**
 * Logs only *unexpected* failures.
 *
 * Both handlers previously logged every error at `console.error`, which meant
 * an ordinary `404` for a mistyped id, or a `403` for a caller without an
 * active org, produced a stack trace in the server log. That is precisely
 * what `docs/backend/error-handling.md` rules out: expected 4xx outcomes are
 * normal control flow, not incidents, and burying real faults under them is
 * how an error log stops being read at all.
 *
 * A typed `ORPCError` below 500 is an expected, already-handled domain or
 * validation outcome — the client is told what happened via its stable
 * `code`/`reason`. Anything else (an unmapped exception, a driver failure, a
 * genuine 5xx) still gets logged in full.
 */
function logUnexpectedError(error: unknown): void {
  if (error instanceof ORPCError && error.status < 500) {
    return;
  }
  console.error(error);
}

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

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
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

import { serve } from "@hono/node-server";

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
