import { Alert, AlertDescription, AlertTitle } from "@fintech-ledger-sandbox/ui/components/alert";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@fintech-ledger-sandbox/ui/components/empty";
import { Skeleton } from "@fintech-ledger-sandbox/ui/components/skeleton";
import type { ReactNode } from "react";

import { describeFailure } from "@/lib/ledger/errors";

/**
 * The three states every screen owes.
 *
 * `docs/product/requirements/ledger.md:73-75` requires skeletons on every
 * fetch, empty states with a next action, and — the one most often collapsed
 * in practice — an error state **visually distinct from empty**, carrying a
 * retry.
 *
 * The distinction is not cosmetic. "No accounts yet" and "we could not reach
 * the server" look identical if both render an empty table, and in a ledger
 * they mean opposite things: one invites you to create an account, the other
 * means the balances on screen may be nothing at all. Conflating them is how a
 * user concludes their money is gone.
 */

/** A skeleton sized to the content it stands in for, so layout does not jump when data lands. */
export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} data-testid="loading-state" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="mb-2 h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * Nothing here yet — and always a way forward.
 *
 * `action` is not optional by accident: an empty state that only says "no data"
 * leaves the user to guess what to do, and every empty surface in this console
 * has an obvious next step.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <Empty data-testid="empty-state">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

/**
 * A load failed.
 *
 * Takes the raw thrown value rather than a formatted string, so no caller has
 * to remember not to render `error.message` — the server's message is a fixed
 * operator-facing string and explicitly not a client contract
 * (`docs/backend/error-handling.md`). `describeFailure` is 5a's single
 * translation point.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const failure = describeFailure(error);

  return (
    <Alert variant="destructive" data-testid="error-state">
      <AlertTitle>{failure.title}</AlertTitle>
      <AlertDescription>
        <p>{failure.detail}</p>
        {failure.rateLimit?.retryAfterSeconds !== undefined ? (
          <p>Try again in about {failure.rateLimit.retryAfterSeconds} seconds.</p>
        ) : null}
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Picks the right state for a query, so screens stop hand-rolling the
 * precedence and getting it subtly wrong.
 *
 * Order matters. Error is checked **before** empty: a failed query has
 * `data === undefined`, so an empty-first branch would render "nothing here
 * yet" for a server that is down — exactly the conflation this module exists
 * to prevent.
 */
export function QueryState<T>({
  query,
  empty,
  children,
  loadingRows,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  };
  empty?: { isEmpty: (data: T) => boolean; render: ReactNode };
  children: (data: T) => ReactNode;
  loadingRows?: number;
}): ReactNode {
  if (query.isPending) {
    return <LoadingRows rows={loadingRows} />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (query.data === undefined) {
    // Not pending, not an error, and still no data. Nothing should produce
    // this, so say so rather than rendering a misleading empty state.
    return <ErrorState error={new Error("No data")} onRetry={() => query.refetch()} />;
  }
  if (empty && empty.isEmpty(query.data)) {
    return empty.render;
  }
  return children(query.data);
}
