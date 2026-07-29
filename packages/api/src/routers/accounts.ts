import { parseCurrency } from "@fintech-ledger-sandbox/core";
import {
  createAccount,
  getAccountById,
  pageAccounts,
} from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { decodeNameCursorOrThrow, encodeNameCursor, pageInputShape } from "../contracts/cursor";
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

  /**
   * Cursor-paginated, ordered by name (open question #7).
   *
   * `nextCursor` is what makes truncation *visible*. This endpoint has three
   * consumers that are not tables — the transfer picker, the transfer
   * eligibility check, and the transaction-detail name lookup — and each of
   * them is only correct over the accounts it actually received. A non-null
   * `nextCursor` is how they know to say "there are more" rather than draw a
   * conclusion from a subset.
   *
   * The unbounded read still exists as `listAccounts` for the server-side
   * callers that must see every account (`sandbox.reset`), and is not reachable
   * from the wire.
   */
  list: orgProcedure
    .input(z.object(pageInputShape))
    .output(
      z.object({
        accounts: z.array(accountSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      const page = await pageAccounts(context.db, context.orgId, {
        limit: input.limit,
        after: decodeNameCursorOrThrow(input.cursor),
      });

      return {
        accounts: page.items.map(toWireAccount),
        nextCursor: page.nextCursor === null ? null : encodeNameCursor(page.nextCursor),
      };
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
