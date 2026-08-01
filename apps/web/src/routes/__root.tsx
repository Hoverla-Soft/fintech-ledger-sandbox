import { Toaster } from "@fintech-ledger-sandbox/ui/components/sonner";
import { TooltipProvider } from "@fintech-ledger-sandbox/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ThemeProvider } from "@/components/theme-provider";
import type { orpc } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "Ledger sandbox",
      },
      {
        name: "description",
        content:
          "A payments-style double-entry ledger sandbox. Fake money, real correctness — balanced postings, reconcilable balances, multi-tenant isolation.",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});

/**
 * Root chrome only: theme, toasts, tooltips, devtools.
 *
 * Two things were removed here in Phase 5b.
 *
 * A **second oRPC client** was constructed in this component
 * (`createORPCClient(link)` plus its own `createTanstackQueryUtils`) and then
 * never read. It survived because `apps/web` had `noUnusedLocals` off; the
 * flag is on as of this slice and this was its only violation in the app. Had
 * it ever been used it would have been a genuine bug — a second client means a
 * second cache, silently diverging from the one every screen reads.
 *
 * The **console header** moved to `components/shell/console-shell.tsx`, which
 * only the `_auth` layout renders. It carries the organization switcher, and
 * an org switcher on the public landing and login pages would be meaningless.
 */
function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <TooltipProvider>
          <div className="h-svh">
            <Outlet />
          </div>
          <Toaster richColors />
        </TooltipProvider>
      </ThemeProvider>
      {import.meta.env.DEV ? (
        <>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        </>
      ) : null}
    </>
  );
}
