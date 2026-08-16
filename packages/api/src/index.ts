/**
 * `@fintech-ledger-sandbox/api` — the ledger's typed API boundary.
 *
 * The oRPC layer: the procedure ladder (public → protected → org → admin),
 * the org/tenant middleware that derives the acting organization from a
 * verified membership, the wire contracts, and the domain-error → HTTP map.
 * It orchestrates use-cases by calling `packages/core` (domain) and
 * `packages/db` (persistence); it contains no SQL and no domain rules of its
 * own.
 *
 * The procedure builders live in `./procedures` rather than in this file —
 * Phase 4a roughly tripled what they involve, and mixing the builder with the
 * package's public entry point made both harder to read. They are re-exported
 * here so no consumer's import path changed.
 *
 * `createContext` is deliberately **not** re-exported. It constructs a
 * connection pool and pulls in `packages/auth` at module scope, so importing
 * it is a side effect an app makes on purpose — `apps/server` imports it
 * directly from `@fintech-ledger-sandbox/api/context`. Keeping it out of this
 * barrel means a test (or the web client's type-only import of the router)
 * never accidentally boots an auth stack and a database connection.
 */

export type { LedgerRole } from "./auth/roles";
export { canWrite, toLedgerRole } from "./auth/roles";
export type { Context, LedgerSession } from "./context";
export type { LedgerApiError, LedgerErrorReason } from "./errors";
export { toORPCError } from "./errors";
export {
  adminProcedure,
  directPostProcedure,
  o,
  orgProcedure,
  protectedProcedure,
  publicProcedure,
} from "./procedures";
export type { AppRouter, AppRouterClient } from "./routers/index";
export { appRouter } from "./routers/index";
