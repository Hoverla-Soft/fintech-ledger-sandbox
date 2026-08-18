import { parseCurrency } from "@fintech-ledger-sandbox/core";
import type { Db } from "@fintech-ledger-sandbox/db";
import {
  createAccount,
  getAccountById,
  pageAccountPostings,
  pageAccounts,
  recordSettingChange,
  setAccountActive,
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

/**
 * The shared half of `deactivate` / `reactivate`.
 *
 * One function rather than two handlers so the audit write cannot be present on
 * one path and missing on the other — the omission that #25 recorded when a
 * permission helper existed but three handlers forgot to call it.
 */
async function setActive(
  context: { db: Db; orgId: string; actorId: string },
  accountId: string,
  active: boolean,
) {
  const updated = await setAccountActive(context.db, {
    orgId: context.orgId,
    accountId,
    active,
  });
  if (!updated.ok) {
    throw toORPCError(updated.error);
  }

  await recordSettingChange(context.db, {
    orgId: context.orgId,
    actorUserId: context.actorId,
    action: active ? "reactivate_account" : "deactivate_account",
    reason: active ? "account_reopened" : "account_closed",
    metadata: { accountId },
  });

  return toWireAccount(updated.value);
}

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

  /**
   * Closes an account, and reopens one.
   *
   * `active` has been enforced under the posting lock since Phase 3 and
   * reported on the wire since Phase 5, but nothing could *set* it — the state
   * was reachable only by raw SQL (`docs/open-questions.md` #8). These two are
   * that missing write, and nothing else: the refusal they produce
   * (`422 account_inactive` on a later posting) already existed and is
   * unchanged.
   *
   * Closing requires a zero balance. A closed account still counts toward every
   * whole-org total and toward reconciliation, so closing a funded one would
   * leave money that is simultaneously on the books and unreachable. The rule
   * lives in the repository's conditional `UPDATE` rather than here, because a
   * balance read in this handler is stale the moment a concurrent transfer
   * commits.
   *
   * Audited, unlike `create`. The distinction is whether the action changes
   * what money can do: creating an empty account changes nothing, while closing
   * one makes every future posting to it fail — a control change, in the same
   * family as toggling `requireTransferApproval`.
   */
  deactivate: adminProcedure
    .input(z.object({ accountId: z.uuid() }))
    .output(accountSchema)
    .handler(async ({ context, input }) => setActive(context, input.accountId, false)),

  reactivate: adminProcedure
    .input(z.object({ accountId: z.uuid() }))
    .output(accountSchema)
    .handler(async ({ context, input }) => setActive(context, input.accountId, true)),

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
