import { parseCurrency } from "@fintech-ledger-sandbox/core";
import {
  createAccount,
  getAccountById,
  pageAccountPostings,
  pageAccounts,
} from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import {
  decodeNameCursorOrThrow,
  decodeTimeCursorOrThrow,
  encodeNameCursor,
  encodeTimeCursor,
  pageInputShape,
} from "../contracts/cursor";
import { moneySchema, toWireMoney } from "../contracts/money";
import { accountSchema, toWireAccount } from "../contracts/wire";
import { toORPCError } from "../errors";
import { adminProcedure, orgProcedure } from "../procedures";

/**
 * Account reads. Procedures sit on `orgProcedure`, so `orgId` arrives from a
 * verified `member` row and no input schema mentions an organization — ADR 0005.
 */

const accountPostingSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  accountId: z.string(),
  direction: z.enum(["debit", "credit"]),
  amount: moneySchema,
  runningBalance: moneySchema,
  createdAt: z.string(),
});

export const accountsRouter = {
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

  /**
   * Statement timeline for one account — oldest first, with running balance.
   * Missing / cross-org accounts collapse to the same `AccountNotFound` as `get`.
   */
  postings: orgProcedure
    .input(
      z.object({
        accountId: z.uuid(),
        ...pageInputShape,
      }),
    )
    .output(
      z.object({
        postings: z.array(accountPostingSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      const account = await getAccountById(context.db, context.orgId, input.accountId);
      if (!account.ok) {
        throw toORPCError(account.error);
      }

      const page = await pageAccountPostings(context.db, {
        orgId: context.orgId,
        accountId: input.accountId,
        limit: input.limit,
        after: decodeTimeCursorOrThrow(input.cursor),
      });

      return {
        postings: page.items.map((row) => ({
          id: row.id,
          transactionId: row.transactionId,
          accountId: row.accountId,
          direction: row.direction,
          amount: toWireMoney(row.amount),
          runningBalance: toWireMoney(row.runningBalance),
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: page.nextCursor === null ? null : encodeTimeCursor(page.nextCursor),
      };
    }),
};
