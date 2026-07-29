import { countReconciliation, pageReconciliation } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { decodeNameCursorOrThrow, encodeNameCursor, pageInputShape } from "../contracts/cursor";
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
 *
 * Paginated in Phase 7a (open question #7), with one rule that outranks the
 * paging: **the verdict is not a fold over the page.** `allReconciled` and the
 * two counts come from `countReconciliation`, a separate whole-org aggregate,
 * so a page of clean accounts cannot report a clean ledger while drift sits on
 * page two. An assertion that only covers the rows you happened to fetch is
 * not an assertion, and this endpoint's whole purpose is to be trustworthy
 * when it says "yes".
 */
export const reconciliationRouter = {
  verify: orgProcedure
    .input(z.object(pageInputShape))
    .output(
      z.object({
        accounts: z.array(reconciliationSchema),
        nextCursor: z.string().nullable(),
        allReconciled: z
          .boolean()
          .describe(
            "True when every account in the organization reconciles — computed over the whole org, not over the page returned. A caller may trust this without walking every page.",
          ),
        accountCount: z.int().describe("Accounts in this organization, whole-org."),
        unreconciledCount: z
          .int()
          .describe(
            "Accounts whose recorded balance disagrees with the sum of their postings, whole-org.",
          ),
      }),
    )
    .handler(async ({ context, input }) => {
      // Issued together: the page and the verdict are independent queries, and
      // the verdict must not wait on the page.
      const [page, totals] = await Promise.all([
        pageReconciliation(context.db, context.orgId, {
          limit: input.limit,
          after: decodeNameCursorOrThrow(input.cursor),
        }),
        countReconciliation(context.db, context.orgId),
      ]);

      return {
        accounts: page.items.map(toWireReconciliation),
        nextCursor: page.nextCursor === null ? null : encodeNameCursor(page.nextCursor),
        allReconciled: totals.unreconciledCount === 0,
        accountCount: totals.accountCount,
        unreconciledCount: totals.unreconciledCount,
      };
    }),
};
