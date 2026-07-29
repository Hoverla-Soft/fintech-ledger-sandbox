import { ACTIVITY_WINDOW_DAYS, summarizeOrg } from "@fintech-ledger-sandbox/db/repositories";

import { orgSummarySchema, toWireOrgSummary } from "../contracts/wire";
import { orgProcedure } from "../procedures";

/**
 * The overview aggregate.
 *
 * Exists because Phase 7a made every list read a page. A dashboard that counted
 * `accounts.list` was already showing a page length dressed up as a total, and
 * pagination turned that from "harmless in a small sandbox" into "wrong as soon
 * as the org grows". The only honest way to answer "how many" and "how much" is
 * to ask the database to count.
 *
 * No input, so no validation: the org comes from a verified `member` row via
 * `orgProcedure` (ADR 0005), and the activity window is a server constant rather
 * than a parameter. Open to both roles — a viewer who can see balances can
 * already see everything totalled here.
 *
 * Every figure is a SQL aggregate. Nothing here returns rows, so the response
 * size is bounded by the number of currencies and days rather than by the number
 * of accounts or transactions.
 */
export const dashboardRouter = {
  summary: orgProcedure.output(orgSummarySchema).handler(async ({ context }) => {
    // The window is computed per request rather than in the repository so the
    // repository stays deterministic — it takes the boundary, it does not read
    // the clock.
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const summary = await summarizeOrg(context.db, context.orgId, since);

    return toWireOrgSummary(summary, ACTIVITY_WINDOW_DAYS);
  }),
};
