import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { useEffect, useState } from "react";

import type { WirePosting } from "@/features/transactions/postings-table";

import { conservationProgress, prefersReducedMotion } from "./conservation";

const STEP_MS = 450;

/**
 * Stages a posted transaction so conservation is felt, not asserted.
 *
 * Reveals each posting in order, advances a conservation meter, and settles on
 * "Nets to zero" when every leg is visible. Reduced-motion users get the final
 * state immediately with a Replay control.
 */
export function MoneyFlowTheater({
  postings,
  accountNames,
  autoPlay = true,
  headline = "Money moved",
  subtitle = "Each posting appears in turn. Debits and credits must finish equal.",
}: {
  postings: readonly WirePosting[];
  accountNames: ReadonlyMap<string, string>;
  autoPlay?: boolean;
  headline?: string;
  subtitle?: string;
}) {
  const reduced = prefersReducedMotion();
  const [revealed, setRevealed] = useState(() => (autoPlay && !reduced ? 0 : postings.length));
  const [playing, setPlaying] = useState(() => autoPlay && !reduced && postings.length > 0);

  useEffect(() => {
    if (!playing || reduced) {
      return;
    }
    if (revealed >= postings.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRevealed((count) => Math.min(count + 1, postings.length));
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, revealed, postings.length, reduced]);

  const progress = conservationProgress({ postings, revealedCount: revealed });
  const visible = postings.slice(0, revealed);

  function replay() {
    if (reduced) {
      setRevealed(postings.length);
      setPlaying(false);
      return;
    }
    setRevealed(0);
    setPlaying(true);
  }

  return (
    <section
      className="space-y-4 rounded-none border border-primary/30 bg-primary/5 p-4"
      data-testid="money-flow-theater"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{headline}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={replay}>
          Replay
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Conservation</span>
          <span className="font-mono tabular-nums">{progress.percent}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-none border bg-background"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          aria-label="Conservation progress"
        >
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-mono text-muted-foreground">
            Debits {progress.debitTotal} {progress.currency} · Credits {progress.creditTotal}{" "}
            {progress.currency}
          </span>
          {progress.balanced ? (
            <Badge variant="success" data-testid="theater-balanced">
              Nets to zero
            </Badge>
          ) : (
            <Badge variant="muted">Balancing…</Badge>
          )}
        </div>
      </div>

      <ol className="space-y-2">
        {visible.map((posting) => (
          <li
            key={posting.id}
            className="flex items-center justify-between gap-3 rounded-none border bg-background px-3 py-2 text-sm animate-in fade-in duration-300 motion-reduce:animate-none"
            data-testid="theater-leg"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {accountNames.get(posting.accountId) ?? posting.accountId}
              </p>
              <Badge
                variant={posting.direction === "debit" ? "outline" : "secondary"}
                className="mt-1"
              >
                {posting.direction}
              </Badge>
            </div>
            <p className="shrink-0 font-mono tabular-nums">
              {posting.amount.amount} {posting.amount.currency}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
