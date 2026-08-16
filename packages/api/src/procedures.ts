import { getOrgSettings, recordRejection } from "@fintech-ledger-sandbox/db/repositories";
import { ORPCError, os } from "@orpc/server";

import { resolveMembership } from "./auth/membership";
import { canWrite, type LedgerRole } from "./auth/roles";
import type { Context } from "./context";
import { enforceLimit, orgWriteLimiter, userWriteLimiter } from "./rate-limit";

/**
 * The procedure ladder. Every router builds on one of these four rungs, and
 * which rung a procedure sits on *is* its access-control decision — there are
 * no ad-hoc permission checks inside handlers.
 *
 *   publicProcedure    — no session required
 *   protectedProcedure — a signed-in user
 *   orgProcedure       — a signed-in user acting within a verified org
 *   adminProcedure     — the above, plus write permission
 *   directPostProcedure — the above, plus "this org is not requiring approval"
 *
 * Split out of `index.ts`, which previously mixed the builder with the
 * package's public entry point. `index.ts` re-exports everything here, so no
 * consumer's import path changes.
 */

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Authentication required.",
    });
  }

  return next({ context: { session: context.session } });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Derives and verifies the acting organization — ADR 0005's enforcement
 * point, and the reason no procedure in this package accepts an `orgId`.
 *
 * The ordering matters. `activeOrganizationId` arrives as a claim on the
 * session; it becomes an `orgId` only after `resolveMembership` finds a real
 * `member` row tying that org to this user. A session naming an org the user
 * was removed from, or never belonged to, fails here — so the value that
 * reaches every downstream `WHERE org_id = ...` is one the database has
 * already vouched for.
 *
 * Both failures are `403`, not `404`. A `404` would mean "this org does not
 * exist," which is a statement about another tenant's data; `403` says only
 * "you may not act here" and reveals nothing either way.
 */
const requireOrg = o.middleware(async ({ context, next }) => {
  const { session, db } = context;

  // Re-checked rather than assumed. `requireAuth` has already run on every
  // procedure this composes onto, but oRPC types a middleware against the
  // context it *declares*, not the chain it happens to sit in — so `session`
  // is `LedgerSession | null` here. Narrowing it again costs one branch and
  // keeps this middleware correct even if it is ever composed somewhere
  // `requireAuth` did not run.
  if (!session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required." });
  }

  if (!session.activeOrganizationId) {
    throw new ORPCError("FORBIDDEN", {
      message: "No active organization for this session.",
      data: { reason: "no_active_organization" },
    });
  }

  const membership = await resolveMembership(db, session.activeOrganizationId, session.userId);

  if (membership === null) {
    throw new ORPCError("FORBIDDEN", {
      message: "You are not a member of this organization.",
      data: { reason: "not_a_member" },
    });
  }

  return next({
    context: {
      orgId: membership.orgId,
      actorId: session.userId,
      role: membership.role,
    },
  });
});

export const orgProcedure = protectedProcedure.use(requireOrg);

/**
 * Write access. Defined and tested in Phase 4a but not yet used by any
 * procedure — the read surface is open to both roles. Phase 4b's
 * `accounts.create` / `transactions.create` / `transactions.reverse` are its
 * first consumers. It ships now so the role model is complete and provable in
 * one place rather than half-built across two phases.
 */
const requireWrite = os
  // Declares what this middleware needs from whatever it is composed onto.
  // `role` is produced by `requireOrg`, so `adminProcedure` below is the only
  // valid composition — oRPC enforces that at the type level rather than
  // leaving it to convention.
  .$context<Context & { role: LedgerRole }>()
  .middleware(async ({ context, next }) => {
    if (!canWrite(context.role)) {
      throw new ORPCError("FORBIDDEN", {
        message: "This action requires an admin role.",
        data: { reason: "insufficient_role" },
      });
    }

    return next();
  });

/**
 * Rate limiting, applied **after** the role check.
 *
 * Order is deliberate: a caller who is not permitted to write should get
 * `403` regardless of anyone's rate budget, and — more importantly — a
 * rejected viewer must not be able to consume the organization's write quota.
 * Running the limiter first would hand any authenticated org member a trivial
 * denial-of-service against that org's admins.
 */
const applyWriteRateLimit = os
  .$context<Context & { orgId: string; actorId: string }>()
  .middleware(async ({ context, next }) => {
    // The per-user limit is charged FIRST, and the order is load-bearing.
    // `limit()` consumes a token as it checks, so charging the org first would
    // spend an org token on a request the user limit is about to reject —
    // letting one admin burn the whole organization's budget with writes that
    // never happened, and lock out every co-admin after their own 30.
    await enforceLimit(userWriteLimiter, context.actorId, "user");
    await enforceLimit(orgWriteLimiter, context.orgId, "organization");
    return next();
  });

export const adminProcedure = orgProcedure.use(requireWrite).use(applyWriteRateLimit);

/**
 * Refuses any *direct* balance change when the org requires maker-checker
 * approval.
 *
 * ## Why this is a rung on the ladder, not a call inside each handler
 *
 * The first version of this control was a helper each write handler called for
 * itself. Three of them did not call it, and an adversarial pass proved all
 * three against a real database with the flag switched on:
 *
 * - `transactions.reverse` — reversing a reversal is deliberately permitted, so
 *   one admin drove an account 100 → 0 → 100 → 0 → 100 with four calls. Any
 *   historical transfer becomes a reusable template for moving that pair of
 *   accounts, unlimited times, with no second approver.
 * - `sandbox.seed` — the `funding` scenario credits a `normal` account from an
 *   `external` one, which is exempt from the negative-balance invariant. Two
 *   calls under different run keys took an account 1500 → 3000. A value faucet.
 * - `sandbox.reset` — drove every account in the org to zero. The most
 *   destructive balance change this API offers was the one path that never
 *   consulted the control.
 *
 * Each of those was an omission, and the reason they were possible is that the
 * guard was something a handler had to *remember*. `docs/development/architecture.md`
 * already states the principle this violates: which rung a procedure is built
 * on **is** its access-control decision, and there are no ad-hoc permission
 * checks inside handlers precisely so a permission cannot be present in one
 * endpoint and missing in its neighbour. This puts the gate back on the ladder.
 *
 * ## What is deliberately NOT on this rung
 *
 * `approvals.approve` stays on plain `adminProcedure`. It is the path this gate
 * forces everyone onto; gating it would mean an org that switches approvals on
 * can never approve anything again. It posts through `postTransaction`
 * directly rather than through a gated wire procedure, and there is a test
 * pinning that.
 */
const requireNoPendingApprovalPolicy = os
  .$context<Context & { orgId: string; actorId: string }>()
  .middleware(async ({ context, next, path }) => {
    const settings = await getOrgSettings(context.db, context.orgId);
    if (!settings.requireTransferApproval) {
      return next();
    }

    // `path` is the procedure's own route (e.g. ["transactions","reverse"]), so
    // the audit row names what was actually attempted without each handler
    // passing a string it could get wrong.
    const action = path.join(".");

    // Best-effort, for the same reason every other rejection audit is: the
    // caller is already getting a correct 403, and turning an audit failure
    // into a 500 would replace an accurate client error with a misleading one.
    try {
      await recordRejection(context.db, {
        orgId: context.orgId,
        actorUserId: context.actorId,
        action,
        reason: "approval_required",
        metadata: { kind: "approval_required" },
      });
    } catch (auditError) {
      console.error({ event: "rejection_audit.failed", action }, auditError);
    }

    throw new ORPCError("FORBIDDEN", {
      message: "This organization requires a second admin to approve transfers.",
      data: { reason: "approval_required" as const },
    });
  });

/**
 * The rung for every procedure that moves a balance directly.
 *
 * `transactions.create` / `reverse` / `exchange` and `sandbox.seed` / `reset`
 * all build on this. Adding a sixth direct-posting procedure inherits the gate
 * by construction rather than by anyone remembering it.
 */
export const directPostProcedure = adminProcedure.use(requireNoPendingApprovalPolicy);
