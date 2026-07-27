import { reconcileAccounts } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { reconciliationSchema, toWireReconciliation } from "../contracts/wire";
import { orgProcedure } from "../procedures";

/**
 * Invariant #2 (`signed Σ(postings) == account.balance`) exposed as an
 * endpoint.
 *
 * ADR 0003 is explicit that this is an invariant a caller may assert at any
 * time rather than a scheduled batch job — correctness is meant to hold
 * continuously as postings write, and this is how a caller or a test checks
 * it. Hence a read-only `verify`, open to both roles: catching drift is not a
 * privileged operation, and a viewer who can see balances can already see
 * everything this returns.
 */
export const reconciliationRouter = {
  verify: orgProcedure
    .output(
      z.object({
        accounts: z.array(reconciliationSchema),
        allReconciled: z.boolean(),
      }),
    )
    .handler(async ({ context }) => {
      const accounts = await reconcileAccounts(context.db, context.orgId);

      return {
        accounts: accounts.map(toWireReconciliation),
        // Derived here so a caller gets the yes/no answer without folding the
        // array itself — and so the "is this org healthy?" check is one field
        // rather than a client-side reduction every consumer reimplements.
        allReconciled: accounts.every((account) => account.reconciled),
      };
    }),
};
