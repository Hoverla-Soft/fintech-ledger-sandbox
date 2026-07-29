import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../procedures";
import { accountsRouter } from "./accounts";
import { auditRouter } from "./audit";
import { dashboardRouter } from "./dashboard";
import { reconciliationRouter } from "./reconciliation";
import { sandboxRouter } from "./sandbox";
import { transactionsRouter } from "./transactions";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),

  accounts: accountsRouter,
  transactions: transactionsRouter,
  reconciliation: reconciliationRouter,
  audit: auditRouter,
  dashboard: dashboardRouter,
  sandbox: sandboxRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
