import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * A persistent, in-flow message.
 *
 * Distinct from `sonner` on purpose: a toast is transient and can be missed,
 * which is the wrong shape for a failure the user has to act on. The console
 * needs a message that stays put next to the thing that failed — a failed
 * load with a retry, a destructive-action warning, a reconciliation alarm.
 *
 * Added Phase 5b as the first consumer (the error state) landed, per the
 * repo's rule that a primitive arrives with its consumer rather than ahead of
 * it (`docs/development/architecture.md`).
 */

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-none border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        // `destructive` is reserved for a failure or a warning about an
        // irreversible action — not for every error, since a retryable load
        // failure is better rendered neutrally than alarmingly.
        destructive:
          "border-destructive/50 bg-card text-destructive [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    // `role="alert"` is deliberate: these announce a state change the user did
    // not ask for and needs to know about, so a screen reader should interrupt.
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm/relaxed text-muted-foreground [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
