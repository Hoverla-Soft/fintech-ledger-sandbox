import { closeDatabasePool } from "@fintech-ledger-sandbox/api/context";
import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { logger } from "./logger";

/**
 * The process. Everything that answers a request lives in `./app`.
 *
 * This file owns exactly what a Hono app cannot: the listener, the signals that
 * end it, and the last-resort handlers for failures that escape every request.
 */

const server = serve(
  {
    fetch: createApp().fetch,
    // Railway (and most PaaS) assigns the port at runtime; 3000 stays the local default.
    port: Number(process.env.PORT) || 3000,
  },
  (info) => {
    logger.info({ port: info.port }, "server_started");
  },
);

/**
 * How long to let in-flight requests finish before giving up on them.
 *
 * Railway sends `SIGTERM` and then `SIGKILL`s after a grace period, so a
 * shutdown that hangs is not a shutdown — it is the same abrupt kill with extra
 * steps. Ten seconds is comfortably longer than any request this API serves and
 * comfortably shorter than a typical platform grace window.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

/**
 * Stop accepting connections, let in-flight work finish, then close the pool.
 *
 * Order matters: `server.close()` first stops *new* connections while allowing
 * live ones to complete, and only then is it safe to end the pool. Closing the
 * pool first would fail the very requests this function exists to protect —
 * including, in the worst case, one mid-transaction on the ledger.
 *
 * The guard makes this idempotent. A supervisor that sends `SIGTERM` and then
 * `SIGINT`, or an operator pressing Ctrl-C twice, would otherwise call
 * `pool.end()` on an already-ending pool.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info({ signal }, "shutdown_started");

  const forceExit = setTimeout(() => {
    logger.error({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "shutdown_timed_out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Do not let this timer be the only thing keeping the event loop alive — a
  // clean shutdown should end the process, not wait out the full timeout.
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    // Idle keep-alive sockets hold the server open past `close()`; without this
    // a browser's pooled connection can stall shutdown until the force-exit
    // timer fires, turning every graceful stop into a 10-second one.
    //
    // Guarded rather than asserted: `serve()` is typed as
    // `Server | Http2Server | Http2SecureServer`, and `closeIdleConnections`
    // exists on the HTTP/1 `Server` but not on `Http2Server`. This app always
    // gets the HTTP/1 one (no `createServer` override), so the branch is always
    // taken — but a cast would quietly become a crash the day someone passes
    // `serverOptions` for http2.
    if ("closeIdleConnections" in server) {
      server.closeIdleConnections();
    }

    await closeDatabasePool();

    clearTimeout(forceExit);
    logger.info({ signal }, "shutdown_complete");
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExit);
    logger.error({ err: error, signal }, "shutdown_failed");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

/**
 * Last-resort handlers.
 *
 * Both **exit** rather than logging and continuing, and for a ledger that is
 * the safer direction: after an unhandled rejection the process has state
 * nobody reasoned about, and the failure mode of continuing is a server that
 * looks healthy while some invariant no longer holds. Postgres is the authority
 * on every balance here — an aborted transaction rolls back, so dying loses
 * nothing that was not already lost, while limping on could write on top of a
 * corrupted assumption.
 *
 * They route through `shutdown` so the pool still closes, and Railway restarts
 * the process. Without these, Node's default is to print to stderr and exit on
 * `uncaughtException` — with no pool close — and Node 15+ exits on unhandled
 * rejection too, so this replaces a silent death with a logged one.
 */
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught_exception");
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled_rejection");
  void shutdown("unhandledRejection");
});
