import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

import { findNavItem } from "./nav";
import { OrgSwitcher } from "./org-switcher";
import { SandboxBadge } from "./sandbox-badge";
import { shortcutLabel } from "./shortcut";

/**
 * Where you are, and how to get somewhere else.
 *
 * The breadcrumb is derived from the route map rather than declared per screen,
 * so a detail route — which has no nav entry of its own — still reports its
 * section instead of rendering a blank bar.
 */
export function ConsoleTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const match = findNavItem(pathname);
  const detailSegment =
    match && pathname.startsWith(`${match.item.to}/`)
      ? pathname.slice(match.item.to.length + 1)
      : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-6">
      {/*
        Below lg the breadcrumb would only repeat the active pill in the nav
        strip directly underneath it, so the space goes to the environment badge
        instead — which the sidebar carries at lg and up.
      */}
      <span className="shrink-0 lg:hidden">
        <SandboxBadge />
      </span>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex">
        {match ? (
          <>
            <span className="shrink-0 text-muted-foreground">{match.group}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            {detailSegment ? (
              <Link
                to={match.item.to}
                className="shrink-0 font-medium underline-offset-4 hover:underline"
              >
                {match.item.label}
              </Link>
            ) : (
              <span className="shrink-0 font-medium" aria-current="page">
                {match.item.label}
              </span>
            )}
            {detailSegment ? (
              <>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={detailSegment}
                  aria-current="page"
                >
                  {detailSegment}
                </span>
              </>
            ) : null}
          </>
        ) : null}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/*
          Looks like a field but is a button: there is no inline search here,
          only the palette, and an input that steals focus without searching
          anything is a lie about what typing will do.
        */}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search or jump to"
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-8 shrink-0 items-center gap-2 rounded-sm border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Search className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Search or jump to…</span>
          <kbd className="ml-1 hidden rounded-sm border border-border px-1 font-mono text-[0.6875rem] text-muted-foreground sm:inline">
            {shortcutLabel()}
          </kbd>
        </button>

        <OrgSwitcher />
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
