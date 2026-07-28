import { Separator } from "@fintech-ledger-sandbox/ui/components/separator";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

import { OrgSwitcher } from "./org-switcher";

/**
 * The chrome every signed-in console route renders inside.
 *
 * Nav links are declared here rather than per-route so a screen added in a
 * later slice is reachable by clicking rather than by typing a URL. 5c–5g each
 * add their own entry as they land; the list is short on purpose until then.
 */
const NAV_LINKS = [
  { to: "/dashboard", label: "Overview" },
  { to: "/accounts", label: "Accounts" },
] as const;

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-rows-[auto_auto_1fr] h-full">
      <div className="flex flex-row items-center justify-between gap-4 px-4 py-2">
        <nav className="flex gap-4 text-sm" aria-label="Console">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="text-muted-foreground hover:text-foreground data-[status=active]:text-foreground data-[status=active]:font-medium"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <OrgSwitcher />
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <Separator />
      <main className="min-h-0 overflow-auto p-4">{children}</main>
    </div>
  );
}
