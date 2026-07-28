import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { LedgerMark } from "./ledger-mark";
import { NAV_GROUPS, NAV_ITEMS } from "./nav";
import { SandboxBadge } from "./sandbox-badge";

/**
 * The console's primary navigation.
 *
 * Grouped rather than flat: "Ledger" is where money moves, "Assurance" is where
 * you check that it moved correctly, and "Environment" is where you reset the
 * whole thing. Seven flat links make the reader scan all seven; three named
 * groups let them skip straight to the two that matter for the question they
 * arrived with.
 *
 * Active state is a tinted fill plus a weight step — not a coloured left rule,
 * which this design system does not use (`DESIGN.md` → Shapes).
 */
export function ConsoleSidebar() {
  return (
    <aside className="hidden border-r bg-sidebar lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <Link to="/" className="flex items-center gap-2.5 outline-none focus-visible:underline">
          <LedgerMark className="size-4 text-primary" />
          <span className="font-semibold tracking-tight">Ledger sandbox</span>
        </Link>
      </div>

      <nav aria-label="Console" className="flex-1 overflow-y-auto px-2 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <h2 className="px-2 pb-1.5 text-label text-muted-foreground uppercase">
              {group.label}
            </h2>
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                      "data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t px-4 py-3">
        <SandboxBadge withDescription />
      </div>
    </aside>
  );
}

/**
 * The same destinations below `lg`, as a horizontally scrollable strip.
 *
 * A 15rem panel is wrong on a phone, and a modal drawer is the usual answer —
 * but a drawer hides every destination behind a tap and needs a focus trap to
 * be accessible. A strip keeps all seven labels present and reachable with no
 * modal at all; the group names are the only thing lost, and they were
 * orientation rather than information.
 */
export function ConsoleMobileNav() {
  return (
    <nav aria-label="Console" className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 lg:hidden">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
            "data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-accent-foreground",
          )}
        >
          <item.icon className="size-4 shrink-0" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
