import { listAuditEntries, listRejections } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { decodeTimeCursorOrThrow, encodeTimeCursor, pageInputShape } from "../contracts/cursor";
import { auditEntrySchema, toWireAuditEntry } from "../contracts/wire";
import { orgProcedure } from "../procedures";

/**
 * The audit log and its rejections view.
 *
 * `rejections` is a filtered read of the same table (`outcome = 'rejected'`),
 * not a second store — see `packages/db/src/repositories/audit.ts`. It gets
 * its own procedure because `ledger.md` line 62 names rejections as a
 * first-class surface, and because "show me what failed" is the question
 * asked far more often than "show me everything."
 *
 * Both are cursor-paginated as of Phase 7a, closing open question #6. Before
 * that they took a bare `limit` capped at 200 with no cursor, so the log was
 * genuinely not walkable past its most recent 200 entries — and an audit log
 * that cannot be walked is one that can quietly stop containing the entry
 * someone is looking for. Ordering is descending (most recent first), so the
 * walk moves backwards in time.
 */

const listOutput = z.object({
  entries: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});

const auditFilterShape = {
  ...pageInputShape,
  action: z.string().min(1).max(80).optional(),
  reason: z.string().min(1).max(80).optional(),
} as const;

export const auditRouter = {
  list: orgProcedure
    .input(z.object(auditFilterShape))
    .output(listOutput)
    .handler(async ({ context, input }) => {
      const page = await listAuditEntries(
        context.db,
        context.orgId,
        {
          limit: input.limit,
          after: decodeTimeCursorOrThrow(input.cursor),
        },
        {
          ...(input.action !== undefined ? { action: input.action } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      );

      return {
        entries: page.items.map(toWireAuditEntry),
        nextCursor: page.nextCursor === null ? null : encodeTimeCursor(page.nextCursor),
      };
    }),

  rejections: orgProcedure
    .input(z.object(auditFilterShape))
    .output(listOutput)
    .handler(async ({ context, input }) => {
      const page = await listRejections(
        context.db,
        context.orgId,
        {
          limit: input.limit,
          after: decodeTimeCursorOrThrow(input.cursor),
        },
        {
          ...(input.action !== undefined ? { action: input.action } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      );

      return {
        entries: page.items.map(toWireAuditEntry),
        nextCursor: page.nextCursor === null ? null : encodeTimeCursor(page.nextCursor),
      };
    }),
};
