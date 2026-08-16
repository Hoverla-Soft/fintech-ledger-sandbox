import {
  getOrgSettings,
  recordSettingChange,
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
      const before = await getOrgSettings(context.db, context.orgId);
      const updated = await setRequireTransferApproval(
        context.db,
        context.orgId,
        input.requireTransferApproval,
      );

      /**
       * Turning the control off is itself an auditable event.
       *
       * Without this, disabling maker-checker leaves no trace at all: an
       * adversarial pass ran flip-off → post → flip-on and the org's entire
       * audit log afterwards was a single ordinary `post_transaction` row,
       * indistinguishable from a transfer in an org that never required
       * approval. The reviewer sees a clean posting in an org whose settings
       * currently *say* approval is required, and nothing anywhere records that
       * the control was ever lifted.
       *
       * That is what separates an accepted bypass from a real one. An admin
       * with the setting permission is allowed to turn it off — but the trail
       * has to show who did it and when, or the control cannot be reasoned
       * about after the fact. Both directions are recorded, since re-enabling
       * is what closes the window a reviewer needs to see.
       *
       * Only on an actual change: a no-op write is not an event.
       */
      if (before.requireTransferApproval !== updated.requireTransferApproval) {
        await recordSettingChange(context.db, {
          orgId: context.orgId,
          actorUserId: context.actorId,
          action: "set_require_transfer_approval",
          reason: updated.requireTransferApproval
            ? "approval_control_enabled"
            : "approval_control_disabled",
          metadata: {
            from: before.requireTransferApproval,
            to: updated.requireTransferApproval,
          },
        });
      }

      return updated;
    }),
};
