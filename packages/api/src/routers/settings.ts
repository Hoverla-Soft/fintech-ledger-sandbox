import {
  getOrgSettings,
  setRequireTransferApproval,
} from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

import { adminProcedure, orgProcedure } from "../procedures";

const settingsSchema = z.object({
  requireTransferApproval: z.boolean(),
});

export const settingsRouter = {
  get: orgProcedure.output(settingsSchema).handler(async ({ context }) => {
    return getOrgSettings(context.db, context.orgId);
  }),

  setRequireTransferApproval: adminProcedure
    .input(z.object({ requireTransferApproval: z.boolean() }))
    .output(settingsSchema)
    .handler(async ({ context, input }) => {
      return setRequireTransferApproval(context.db, context.orgId, input.requireTransferApproval);
    }),
};
