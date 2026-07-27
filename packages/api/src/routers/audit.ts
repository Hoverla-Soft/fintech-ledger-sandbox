import { listAuditEntries, listRejections } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

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
 */
const MAX_LIMIT = 200;

const listInput = z.object({
  limit: z.int().min(1).max(MAX_LIMIT).optional(),
});

const listOutput = z.object({
  entries: z.array(auditEntrySchema),
});

export const auditRouter = {
  list: orgProcedure
    .input(listInput)
    .output(listOutput)
    .handler(async ({ context, input }) => {
      const entries = await listAuditEntries(context.db, context.orgId, input.limit);
      return { entries: entries.map(toWireAuditEntry) };
    }),

  rejections: orgProcedure
    .input(listInput)
    .output(listOutput)
    .handler(async ({ context, input }) => {
      const entries = await listRejections(context.db, context.orgId, input.limit);
      return { entries: entries.map(toWireAuditEntry) };
    }),
};
