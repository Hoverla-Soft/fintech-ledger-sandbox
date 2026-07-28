import type { ReactNode } from "react";
import { useState } from "react";

import { CommandPalette } from "./command-palette";
import { ConsoleMobileNav, ConsoleSidebar } from "./sidebar";
import { ConsoleTopBar } from "./top-bar";

/**
 * The chrome every signed-in console route renders inside.
 *
 * A two-column application frame: persistent navigation on the left from `lg`
 * up, and a content column that owns its own scroll. The scroll container being
 * `main` rather than the document is what lets a ledger table's header stick to
 * the top of the reading area instead of scrolling away with the page.
 *
 * Destinations are declared once in `nav.ts` and read by the sidebar, the
 * breadcrumb, and the palette, so a screen added later cannot end up reachable
 * only by typing its URL.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <ConsoleSidebar />

      {/*
        `min-w-0` is load-bearing. A grid item's automatic minimum size is its
        content, so without it a wide table or a crowded top bar pushes this
        column past its track and the *whole page* scrolls sideways — taking the
        breadcrumb and the table's first columns off screen. With it, overflow
        stays inside whichever element owns it.
      */}
      <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
        <ConsoleTopBar onOpenPalette={() => setPaletteOpen(true)} />
        <ConsoleMobileNav />
        <main className="min-h-0 overflow-auto px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
