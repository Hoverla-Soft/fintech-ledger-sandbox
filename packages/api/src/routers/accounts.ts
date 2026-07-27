import { getAccountById, listAccounts } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { accountSchema, toWireAccount } from "../contracts/wire";
import { toORPCError } from "../errors";
import { orgProcedure } from "../procedures";

/**
 * Account reads. Both procedures sit on `orgProcedure`, so `orgId` arrives
 * from a verified `member` row and neither input schema mentions an
 * organization — see ADR 0005.
 */

export const accountsRouter = {
  list: orgProcedure
    .output(z.object({ accounts: z.array(accountSchema) }))
    .handler(async ({ context }) => {
      const accounts = await listAccounts(context.db, context.orgId);
      return { accounts: accounts.map(toWireAccount) };
    }),

  /**
   * A cross-org id and a genuinely missing id produce byte-identical `404`s.
   * `packages/db` collapses both into the same `AccountNotFound` on purpose
   * (`ledger.md` line 56), and this handler simply forwards it — there is no
   * branch here that could distinguish them and leak the difference.
   */
  get: orgProcedure
    .input(z.object({ accountId: z.uuid() }))
    .output(accountSchema)
    .handler(async ({ context, input }) => {
      const result = await getAccountById(context.db, context.orgId, input.accountId);

      if (!result.ok) {
        throw toORPCError(result.error);
      }

      return toWireAccount(result.value);
    }),
};
