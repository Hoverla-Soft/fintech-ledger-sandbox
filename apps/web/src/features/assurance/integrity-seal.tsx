import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

import { integritySealLabel } from "./integrity-seal-label";

/**
 * Ambient integrity proof in the console chrome.
 *
 * Reconciliation already exists as a page; burying it means a visitor never
 * sees the product's differentiator. This seal reuses `reconciliation.verify`'s
 * whole-org aggregates (`allReconciled`, `accountCount`) and links to the full
 * check. Deliberately not polled — ADR 0003 treats verification as on-demand.
 */
export function IntegritySeal({ compact = false }: { compact?: boolean }) {
  const reconciliation = useQuery({
    ...orpc.reconciliation.verify.queryOptions({ input: { limit: 1 } }),
    // Fresh enough for a demo, cheap enough not to hammer the API on every
    // navigation. Manual refetch still available on the reconciliation page.
    staleTime: 30_000,
  });

  if (reconciliation.isPending) {
    return (
      <Badge variant="muted" data-testid="integrity-seal-loading">
        Checking…
      </Badge>
    );
  }

  if (reconciliation.isError || !reconciliation.data) {
    return (
      <Link
        to="/reconciliation"
        className="inline-flex outline-none focus-visible:underline"
        aria-label="Open reconciliation — integrity check unavailable"
      >
        <Badge variant="secondary" data-testid="integrity-seal-unknown">
          Integrity unknown
        </Badge>
      </Link>
    );
  }

  const { allReconciled, accountCount, unreconciledCount } = reconciliation.data;
  const label = integritySealLabel({
    allReconciled,
    accountCount,
    unreconciledCount,
    compact,
  });

  return (
    <Link
      to="/reconciliation"
      className="inline-flex outline-none focus-visible:underline"
      aria-label={
        allReconciled
          ? `All ${accountCount} accounts reconcile — open reconciliation`
          : `Reconciliation failed for ${unreconciledCount} accounts — open reconciliation`
      }
    >
      <Badge
        variant={allReconciled ? "success" : "warning"}
        data-testid="integrity-seal"
        data-state={allReconciled ? "clean" : "drift"}
      >
        {label}
      </Badge>
    </Link>
  );
}
