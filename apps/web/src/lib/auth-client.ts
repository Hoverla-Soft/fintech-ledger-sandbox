import { env } from "@fintech-ledger-sandbox/env/web";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function getServerUrl(url: string) {
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

  if (!normalized.startsWith("/")) {
    return normalized;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${normalized}`;
  }

  const processEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const vercelUrl =
    processEnv?.VERCEL_ENV === "production"
      ? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
      : (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelUrl) {
    const origin = vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
    return `${origin}${normalized}`;
  }

  return `http://localhost:3000${normalized}`;
}
export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: new URL("/api/auth", getServerUrl(env.VITE_SERVER_URL)).toString(),

  /**
   * The tenancy plugin — added Phase 5b, and the reason any org-scoped
   * endpoint is reachable from a browser at all.
   *
   * It must mirror the server, which has registered `organization()` since
   * Phase 1 (`packages/auth/src/index.ts:35`). Without the client half, the
   * session carries no `activeOrganizationId`, so `requireOrg` rejects every
   * request with `403 no_active_organization`
   * (`packages/api/src/procedures.ts:67`) — which is precisely the state the
   * console was in before this slice: `activeOrganizationId` appeared zero
   * times anywhere under `apps/web`.
   *
   * This is also the *only* sanctioned way the acting organization changes.
   * ADR 0005 makes the org a server-derived value: the session's
   * `activeOrganizationId` is a claim, promoted to a fact only by a matching
   * `member` row. `organization.setActive` updates that claim through Better
   * Auth; no ledger procedure accepts an `orgId`, and
   * `packages/api/src/routers/no-org-input.test.ts` asserts mechanically that
   * none ever will.
   */
  plugins: [organizationClient()],
});
