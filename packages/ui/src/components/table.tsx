import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

/**
 * A plain semantic table.
 *
 * Deliberately not a data-grid: there is no `@tanstack/react-table` in this
 * repo and the console's tables are small, server-sorted, and server-paginated
 * (`accounts.list` returns every row; `transactions.list` is cursor-paged by
 * the API). Adding a headless table library to render `<tr>`s would be the
 * abstraction-for-one-time-logic CLAUDE.md rules out.
 *
 * The outer wrapper scrolls horizontally on its own so a wide ledger table
 * never makes the whole page scroll sideways. `containerClassName` reaches that
 * wrapper — a caller that wants the header to stick within a bounded viewport
 * rather than within the page needs to constrain the scroller, and `className`
 * lands on the `<table>`.
 *
 * When it does overflow, the wrapper becomes a labelled, focusable scroll
 * region: on a narrow screen the balance column is usually the part hidden off
 * the right edge, and a scroller with no focusable content is reachable by
 * pointer only. The measurement is what keeps that honest — an unconditional
 * `tabIndex` would put a dead tab stop in front of every table that fits.
 */
function Table({
  className,
  containerClassName,
  scrollRegionLabel = "Table, scrollable horizontally",
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string;
  scrollRegionLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setScrollable(container.scrollWidth > container.clientWidth);
    });
    observer.observe(container);
    const table = container.querySelector("table");
    if (table) {
      observer.observe(table);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      data-scrollable={scrollable ? "" : undefined}
      className={cn(
        "relative w-full overflow-x-auto",
        scrollable && "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        containerClassName,
      )}
      {...(scrollable
        ? { tabIndex: 0, role: "region" as const, "aria-label": scrollRegionLabel }
        : {})}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

/**
 * Sticky by default.
 *
 * A ledger table is read by scanning down a column, and a column is only
 * identifiable while its header is visible — forty rows into a posting history
 * the reader has otherwise lost track of which figure is debit and which is
 * credit. The header sticks to whichever ancestor scrolls (the console's `main`
 * for a full-page table, a bounded container when one is provided) and carries
 * an opaque canvas fill so rows cannot show through it.
 */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10 bg-background [&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // The `has-` rule is what makes keyboard traversal legible: tabbing
        // through a long history moves an invisible caret unless the whole row
        // responds the way it does under the pointer.
        "border-b transition-colors hover:bg-accent/60 has-[a:focus-visible]:bg-accent/60 data-[state=selected]:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `numeric` is the one thing a money column must not have to remember.
 *
 * A column of amounts is only comparable when the digits line up, so the
 * alignment and the tabular figures live on the cell rather than in each
 * caller's class list — a header that forgets `text-right` while its cells do
 * not is a silent, permanent misalignment.
 */
function TableHead({
  className,
  numeric,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      data-numeric={numeric ? "" : undefined}
      className={cn(
        "h-9 px-3 text-left align-middle text-label whitespace-nowrap text-muted-foreground uppercase",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  numeric,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric ? "" : undefined}
      className={cn("px-3 py-2 align-middle", numeric && "text-right font-mono", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow };
