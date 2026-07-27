import { auth } from "@fintech-ledger-sandbox/auth";
import { createDb, type Db } from "@fintech-ledger-sandbox/db";
import type { Context as HonoContext } from "hono";

/**
 * The request context every procedure receives.
 *
 * `session` is deliberately **not** Better Auth's session type. This package
 * needs exactly two facts from a session — who is calling, and which org they
 * claim to be acting within — so it declares that minimum shape and adapts
 * Better Auth's richer object into it in `createContext` below. Two things
 * fall out of that: the procedures and routers never depend on Better Auth's
 * generic session type (which changes shape as plugins are registered), and a
 * test can build a context from a plain object literal without bootstrapping
 * an auth stack. It is a small anti-corruption boundary, the same idea
 * `docs/development/architecture.md` applies to provider payloads.
 *
 * Note `activeOrganizationId` is only a *claim* here. It is not trusted until
 * `orgProcedure` verifies it against a real `member` row — see
 * `auth/membership.ts`.
 */
export interface LedgerSession {
  readonly userId: string;
  readonly activeOrganizationId: string | null;
}

export interface Context {
  readonly db: Db;
  readonly session: LedgerSession | null;
}

/**
 * One connection pool for the process, not one per request.
 *
 * `packages/db` exposes no `db` singleton on purpose (its `src/index.ts`
 * documents at length why a lazy `Proxy` was tried and rejected), so
 * ownership of the single instance lands here, at the composition root of the
 * API layer. Building a `Db` inside `createContext` would open a fresh
 * `pg.Pool` on every HTTP request — the pool exists precisely to be reused
 * across them.
 */
const db = createDb();

export type CreateContextOptions = {
  context: HonoContext;
};

/**
 * Builds the per-request context: the shared db handle plus the caller's
 * session, if any. An unauthenticated request gets `session: null` rather
 * than an error — rejecting is `protectedProcedure`'s job, and `healthCheck`
 * is legitimately public.
 */
export async function createContext({ context }: CreateContextOptions): Promise<Context> {
  const authSession = await auth.api.getSession({
    headers: context.req.raw.headers,
  });

  if (!authSession) {
    return { db, session: null };
  }

  return {
    db,
    session: {
      userId: authSession.user.id,
      activeOrganizationId: authSession.session.activeOrganizationId ?? null,
    },
  };
}
