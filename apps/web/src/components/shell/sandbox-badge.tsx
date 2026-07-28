import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";

/**
 * Says out loud which environment this is.
 *
 * Not a disclaimer to tuck away: "fake money, real correctness" is the
 * product's own framing (`PRODUCT.md`), and an operator looking at a balance
 * should never have to wonder whether it represents real funds. Amber rather
 * than red — this is expected-and-notable, not an error.
 *
 * Deliberately not a tooltip trigger. The qualification is the point of the
 * badge, and a hover-only tooltip on a non-focusable element is unreachable by
 * keyboard and by touch; it ships as real text instead, visible in the sidebar
 * where there is room and screen-reader-only where there is not.
 */
export function SandboxBadge({ withDescription = false }: { withDescription?: boolean }) {
  return (
    <span className={withDescription ? "flex flex-col items-start gap-1.5" : "inline-flex"}>
      <Badge variant="warning">Sandbox</Badge>
      <span
        className={withDescription ? "text-xs leading-snug text-muted-foreground" : "sr-only"}
        data-testid="sandbox-description"
      >
        Fake money. No real funds move here.
      </span>
    </span>
  );
}
