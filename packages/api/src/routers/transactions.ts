import { getTransactionById, listTransactions } from "@fintech-ledger-sandbox/db/repositories";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { cursorSchema, decodeCursor, encodeCursor } from "../contracts/cursor";
import { transactionSchema, transactionWithPostingsSchema, toWireTransaction, toWireTransactionWithPostings } from "../contracts/wire";
import { toORPCError } from "../errors";
import { orgProcedure } from "../procedures";

/**
 * Transaction and posting reads.
 *
 * `MAX_PAGE_SIZE` is declared here as well as in `packages/db` — deliberately
 * not shared. They enforce different things: this one rejects an unreasonable
 * request at the contract boundary with a `400`, while the repository's own
 * clamp is an unconditional server-side ceiling that holds no matter which
 * caller reaches it. A caller asking for 10_000 gets told so, rather than
 * silently receiving 200 and believing it saw everything.
 */
const MAX_PAGE_SIZE = 200;

export const transactionsRouter = {
  list: orgProcedure
    .input(
      z.object({
        limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
        cursor: cursorSchema.optional(),
      }),
    )
    .output(
      z.object({
        transactions: z.array(transactionSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      // A cursor is opaque, so a malformed one is a bad request, not a
      // server fault. Decoding before the query also keeps an Invalid Date
      // from reaching Drizzle, where it would become SQL NULL and silently
      // return an empty page instead of an error.
      let after;
      if (input.cursor !== undefined) {
        const decoded = decodeCursor(input.cursor);
        if (decoded === null) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Malformed pagination cursor.",
            data: { reason: "invalid_cursor" },
          });
        }
        after = decoded;
      }

      const page = await listTransactions(context.db, {
        orgId: context.orgId,
        limit: input.limit,
        after,
      });

      return {
        transactions: page.items.map(toWireTransaction),
        nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      };
    }),

  /** Same indistinguishable-`404` contract as `accounts.get`. */
  get: orgProcedure
    .input(z.object({ transactionId: z.uuid() }))
    .output(transactionWithPostingsSchema)
    .handler(async ({ context, input }) => {
      const result = await getTransactionById(context.db, context.orgId, input.transactionId);

      if (!result.ok) {
        throw toORPCError(result.error);
      }

      return toWireTransactionWithPostings(result.value);
    }),
};
