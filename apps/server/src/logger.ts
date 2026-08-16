import { env } from "@fintech-ledger-sandbox/env/server";
import { ORPCError } from "@orpc/server";
import { pino } from "pino";

/**
 * The structured logger `docs/development/tech-stack.md` has declared since
 * Phase 4b, delivered 2026-08-16.
 *
 * ## Why redaction is configured here and not left to call sites
 *
 * `docs/backend/error-handling.md`'s verification checklist carried "secret and
 * sensitive-data redaction has an automated test" as **open**, with the reason
 * "no structured logger exists yet, so there is no redaction layer to test".
 * A redaction rule that each call site has to remember is not a layer — it is a
 * convention, and the first `log.error({ req })` written by someone in a hurry
 * puts a session cookie in the log. Configuring it on the logger means the
 * unsafe shape is unloggable regardless of who writes the call.
 *
 * The paths below are the four things that actually reach this process and
 * would matter if they leaked: the Better Auth session cookie (which *is* the
 * session — leaking it is leaking the account), an `Authorization` header, and
 * the two secrets `packages/env` validates at boot. `censor` is the literal
 * string rather than removal so a reader can tell the difference between
 * "this field was absent" and "this field was hidden".
 */
export const REDACTED_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "headers.cookie",
  "headers.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "*.DATABASE_URL",
  "*.BETTER_AUTH_SECRET",

  // The two that are not obvious, and the reason this list is not just
  // "cookies and secrets".
  //
  // `drizzle-orm`'s `DrizzleQueryError` carries `query: string` and
  // `params: any[]` as own enumerable properties, and pino's default `err`
  // serializer emits every own enumerable property. So *any* failed statement
  // logs its bound values — and Better Auth's Drizzle adapter binds session
  // tokens and password hashes. Verified against pino 10.3.1: without these two
  // paths a failing `insert into session (token) values ($1)` prints the token
  // in full; with them it prints `[redacted]`.
  //
  // The query text is redacted alongside the params because a statement is the
  // map to what the params meant.
  "err.query",
  "err.params",
];

const isProduction = env.NODE_ENV === "production";

/**
 * One JSON line per event, in every environment.
 *
 * Deliberately **not** `pino-pretty`. It is a second dependency whose only job
 * is making local output legible, and `pino.transport` runs it in a worker
 * thread per process to do that. Anyone who wants pretty local logs can pipe
 * them — `pnpm dev:server | npx pino-pretty` — which costs the repo nothing and
 * keeps one log format everywhere, so a line read locally is the same line
 * parsed downstream.
 *
 * `level` is env-overridable because that is the other half of the checklist
 * item ("dev and production log thresholds/formats are configured"): `info` in
 * production, `debug` locally, and `LOG_LEVEL` wins over both when a specific
 * run needs more. Read from `process.env` rather than the validated schema on
 * purpose — an unset or misspelled value must fall back to the default, not
 * fail boot, which is what adding it to `packages/env` would do.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
});

/**
 * Logs only *unexpected* failures.
 *
 * Both oRPC handlers previously logged every error at `console.error`, which
 * meant an ordinary `404` for a mistyped id, or a `403` for a caller without an
 * active org, produced a stack trace in the server log. That is precisely what
 * `docs/backend/error-handling.md` rules out: expected 4xx outcomes are normal
 * control flow, not incidents, and burying real faults under them is how an
 * error log stops being read at all.
 *
 * The check stays an `instanceof ORPCError` rather than a structural test for
 * a numeric `status`: this function decides what does *not* get logged, and a
 * duck-typed version would silently swallow any unrelated failure that happened
 * to carry a `status` below 500 — a driver or fetch error, exactly the class of
 * fault this log exists to surface. Narrow is the safe direction here.
 */
export function logUnexpectedError(error: unknown): void {
  if (error instanceof ORPCError && error.status < 500) {
    return;
  }

  logger.error({ err: error }, "unexpected_error");
}
