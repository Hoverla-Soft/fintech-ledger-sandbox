import { parseCurrency } from "@fintech-ledger-sandbox/core";
import { createAccount, getAccountById, listAccounts } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { accountSchema, toWireAccount } from "../contracts/wire";
import { toORPCError } from "../errors";
import { adminProcedure, orgProcedure } from "../procedures";

/**
 * Account reads. Both procedures sit on `orgProcedure`, so `orgId` arrives
 * from a verified `member` row and neither input schema mentions an
 * organization — see ADR 0005.
 */

export const accountsRouter = {
  /**
   * Admin-only. A duplicate `(org_id, name)` returns `409 account_name_taken`
   * rather than the unhandled 500 it produced before Phase 4b — the schema's
   * unique constraint stays the arbiter (a check-then-insert would be racy),
   * but `packages/db` now translates its violation into a typed error.
   */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        currency: z.string().min(1).max(10),
        type: z.enum(["normal", "external"]),
      }),
    )
    .output(accountSchema)
    .handler(async ({ context, input }) => {
      const currency = parseCurrency(input.currency);
      if (!currency.ok) {
        throw toORPCError(currency.error);
      }

      const created = await createAccount(context.db, {
        orgId: context.orgId,
        name: input.name,
        currency: currency.value,
        type: input.type,
      });

      if (!created.ok) {
        throw toORPCError(created.error);
      }

      return toWireAccount(created.value);
    }),

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
