import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../procedures";
import { accountsRouter } from "./accounts";
import { approvalsRouter } from "./approvals";
import { auditRouter } from "./audit";
import { dashboardRouter } from "./dashboard";
import { reconciliationRouter } from "./reconciliation";
import { sandboxRouter } from "./sandbox";
import { sessionRouter } from "./session";
import { settingsRouter } from "./settings";
import { transactionsRouter } from "./transactions";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),

  session: sessionRouter,
  accounts: accountsRouter,
  transactions: transactionsRouter,
  approvals: approvalsRouter,
  settings: settingsRouter,
  reconciliation: reconciliationRouter,
  audit: auditRouter,
  dashboard: dashboardRouter,
  sandbox: sandboxRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
