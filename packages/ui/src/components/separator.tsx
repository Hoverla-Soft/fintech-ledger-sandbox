import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";

/**
 * A rule between sections.
 *
 * The package had no standalone divider before Phase 5b — only
 * `DropdownMenuSeparator` (bound to the menu) and `Marker variant="separator"`
 * (bound to the chat scaffolding). `apps/web/src/components/header.tsx` was
 * hand-rolling a bare `<hr />` as a result. This is that class string lifted
 * into a primitive so the shell and later screens share one.
 *
 * `decorative` controls whether assistive technology is told about it. A rule
 * that merely looks tidy should be `aria-hidden`; one that genuinely marks a
 * boundary between groups should announce itself as a separator.
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}) {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
