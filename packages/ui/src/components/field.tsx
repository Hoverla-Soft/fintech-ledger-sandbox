import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";

/**
 * A labelled form field with its error message.
 *
 * Exists to make one rule hard to get wrong: **a field error has to be
 * programmatically tied to its input**, not merely rendered underneath it. A
 * red sentence floating below a text box is invisible to a screen reader user,
 * who hears only "Name, edit text" and no indication that the value was
 * rejected. `FieldError` wires `aria-describedby` and `aria-invalid` through
 * `FieldControl` so the message is announced.
 *
 * This matters more here than in most forms. The console's inline errors are
 * where `409 account_name_taken` and `422 insufficient_funds` land — server
 * decisions about money that the user has to read and act on
 * (`docs/product/requirements/ledger.md`).
 *
 * Deliberately a small hand-rolled composition rather than Base UI's `Field`:
 * that primitive drives validity from the DOM's own constraint validation,
 * while every error the console shows arrives from the *server* after a
 * request. Wiring server errors through a DOM-validity model fights it.
 */

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("space-y-2", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<"label"> & { htmlFor: string }) {
  return (
    <label
      data-slot="field-label"
      className={cn("text-sm leading-none font-medium select-none", className)}
      {...props}
    />
  );
}

/**
 * Renders a field's error and returns the id to point `aria-describedby` at.
 * Renders nothing when there is no error, so callers can pass it
 * unconditionally.
 */
function FieldError({
  id,
  message,
  className,
  ...props
}: React.ComponentProps<"p"> & { id: string; message?: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p
      data-slot="field-error"
      id={id}
      // `role="alert"` so a server rejection arriving after submit is
      // announced, not silently painted.
      role="alert"
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {message}
    </p>
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * The accessibility wiring for a control, derived from whether it has an error.
 * Spread onto the input so callers cannot forget it.
 */
function fieldControlProps({
  id,
  errorId,
  hasError,
  describedById,
}: {
  id: string;
  errorId: string;
  hasError: boolean;
  describedById?: string;
}) {
  const describedBy = [hasError ? errorId : null, describedById].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": hasError || undefined,
    "aria-describedby": describedBy.length > 0 ? describedBy : undefined,
  } as const;
}

export { Field, FieldDescription, FieldError, FieldLabel, fieldControlProps };
