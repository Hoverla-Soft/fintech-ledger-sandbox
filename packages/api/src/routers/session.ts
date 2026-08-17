import { z } from "zod";

import { orgProcedure } from "../procedures";

/**
 * What the caller is, according to the server.
 *
 * ## Why this exists
 *
 * `requireOrg` already resolves all three of these — it verifies the session's
 * `activeOrganizationId` claim against a real `member` row and maps that row's
 * Better Auth role through `toLedgerRole` — but until now the result lived only
 * in middleware context, reachable by handlers and by nothing else. Open
 * question #1 recorded the consequence since Phase 5b: the console could not
 * ask "am I an admin here?", so it re-derived the answer client-side from the
 * same mapping and paid a Better Auth member round-trip to do it.
 *
 * That duplication was never a security problem — every write is authorized
 * server-side regardless of what the console believes — but two copies of one
 * rule is two things to keep in agreement, and the client's copy can be stale
 * in a way the server's per-request lookup never is.
 *
 * ## Why it grants nothing
 *
 * This adds no authority. It returns values `requireOrg` has already derived
 * and verified for this exact request, about the caller and nobody else. It is
 * deliberately `orgProcedure` rather than `adminProcedure`: a `viewer` asking
 * what role they hold is not a privileged act, and refusing them would leave
 * the console with no way to know it should hide a write affordance — the
 * problem this procedure exists to solve.
 *
 * It must never grow into a members list. "Who else is in this org, and what
 * are they" is a different question with a different blast radius; answering it
 * here would turn a self-description into an enumeration surface.
 */
export const sessionRouter = {
  context: orgProcedure
    .output(
      z.object({
        userId: z.string(),
        orgId: z.string(),
        role: z.enum(["admin", "viewer"]),
      }),
    )
    .handler(({ context }) => {
      return {
        userId: context.actorId,
        orgId: context.orgId,
        role: context.role,
      };
    }),
};
