import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * A small status pill.
 *
 * The console uses it for facts that change how a row should be read — an
 * account's `type` (`normal` vs `external`, which decides whether a negative
 * balance is normal or impossible) and its active status. Those are not
 * decoration: `external` is the reason an account is *allowed* to go negative,
 * so the distinction has to be visible right next to the number.
 *
 * `render` is Base UI's composition prop — this package is built on Base UI,
 * not Radix, so there is no `asChild` (`docs/development/tech-stack.md`).
 * Follows `marker.tsx`'s `mergeProps` shape so a caller's `className` and
 * event handlers compose rather than overwrite.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-none border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        destructive: "border-transparent bg-destructive text-white",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant, className })) }, props),
    render,
    state: { slot: "badge", variant },
  });
}

export { Badge, badgeVariants };
