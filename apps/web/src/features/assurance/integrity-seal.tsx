import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

/** Ambient integrity proof — reuses `reconciliation.verify` aggregates. */
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
  const label = allReconciled
    ? compact
      ? "Verified"
      : `Verified · ${accountCount} ${accountCount === 1 ? "account" : "accounts"}`
    : compact
      ? "Drift"
      : `Drift · ${unreconciledCount} of ${accountCount}`;

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
