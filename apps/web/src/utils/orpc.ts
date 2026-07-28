import type { AppRouterClient } from "@fintech-ledger-sandbox/api/routers/index";
import { env } from "@fintech-ledger-sandbox/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { describeFailure } from "@/lib/ledger/errors";

/**
 * The query client.
 *
 * Rewritten in Phase 5b. It previously toasted `error.message` on every failed
 * query — a direct violation of `docs/backend/error-handling.md`, which makes
 * `data.reason` the client contract and `message` explicitly *not* one. The
 * server's message is a fixed per-branch string chosen to leak nothing (never
 * interpolated with an id, never a driver error), so it is both useless to a
 * user and liable to change without notice. Everything now goes through 5a's
 * `describeFailure`.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A ledger balance that is thirty seconds stale is a wrong number on
        // screen. Kept short deliberately; screens that can tolerate more say
        // so themselves.
        staleTime: 5_000,
        retry: (failureCount, error) => {
          // Never retry something a retry cannot fix. A 403 or a 422 is a
          // decision, not a blip, and re-asking produces the same answer while
          // burning the org's rate-limit budget.
          const status = readStatus(error);
          if (status !== null && status >= 400 && status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        // Writes are NEVER retried automatically. `transactions.create` is
        // idempotent only under a stable key, and an automatic retry that
        // happened to remint one would post twice (ADR 0006:17). Retry is a
        // deliberate user action in this console, not a transport behaviour.
        retry: false,
      },
    },

    queryCache: new QueryCache({
      /**
       * Failed *reads* are surfaced in place by the screen's `ErrorState`,
       * which can offer a retry next to the thing that failed. A toast here as
       * well would double-report every failure, so this stays silent except
       * for the session-level cases, which no single screen owns.
       */
      onError: (error) => {
        const failure = describeFailure(error);
        if (failure.disposition === "reauthenticate") {
          toast.error(failure.title, { description: failure.detail });
        }
      },
    }),

    mutationCache: new MutationCache({
      /**
       * Failed *writes* are the opposite case: the form that submitted stays
       * open and renders the reason inline (`ledger.md:75`), so a toast would
       * be redundant — except when the failure means the form cannot help,
       * which is exactly `blocked` and `reauthenticate`.
       */
      onError: (error) => {
        const failure = describeFailure(error);
        if (failure.disposition === "blocked" || failure.disposition === "reauthenticate") {
          toast.error(failure.title, { description: failure.detail });
        }
      },
    }),
  });
}

/** oRPC surfaces the HTTP status on the error object; anything else is a transport failure. */
function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export const queryClient = createQueryClient();

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
export const link = new RPCLink({
  url: `${getServerUrl(env.VITE_SERVER_URL)}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
