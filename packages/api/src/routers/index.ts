import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../procedures";
import { accountsRouter } from "./accounts";
import { auditRouter } from "./audit";
import { reconciliationRouter } from "./reconciliation";
import { sandboxRouter } from "./sandbox";
import { transactionsRouter } from "./transactions";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),

  /**
   * Better-T-Stack scaffolding, kept deliberately.
   *
   * `apps/web/src/routes/_auth/dashboard.tsx` still consumes it, and
   * `apps/web` is out of scope for Phase 4a — deleting it here would break
   * `check-types` and `build` with no in-scope way to fix the consumer. It
   * returns only the caller's own identity and no org-scoped data, so it
   * leaks nothing. Phase 5 removes it when the console is rebuilt against the
   * real read endpoints below.
   *
   * `user` became `userId` because `Context["session"]` is now this package's
   * own minimal `LedgerSession` rather than Better Auth's session object. The
   * web dashboard only renders `.message`, so nothing downstream breaks.
   */
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      userId: context.session?.userId ?? null,
    };
  }),

  accounts: accountsRouter,
  transactions: transactionsRouter,
  reconciliation: reconciliationRouter,
  audit: auditRouter,
  sandbox: sandboxRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
