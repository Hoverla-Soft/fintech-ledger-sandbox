import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { isExpectedRejection, type ScenarioOutcome } from "@/features/sandbox/scenario-outcomes";

const EXPLAIN: Record<string, { title: string; body: string }> = {
  funding: {
    title: "Funding",
    body: "Money enters the sandbox through an external account. External balances may go negative — they represent the outside world.",
  },
  payroll: {
    title: "Payroll run",
    body: "A balanced multi-destination transfer pays several accounts in one commit. Every debit has matching credits.",
  },
  marketplace_payout: {
    title: "Marketplace payout",
    body: "A fee-split journal: merchant, platform fee, and funding legs post together or not at all.",
  },
  insufficient_funds: {
    title: "Insufficient funds",
    body: "A normal account cannot go negative. This scenario is designed to be refused — the rejection is the proof.",
  },
  reversal: {
    title: "Reversal",
    body: "Corrections append mirrored postings. History is never edited; the original transaction stays intact.",
  },
};

/**
 * Turns seed outcomes into a pitchable walkthrough.
 *
 * After scenarios run, an operator steps through each result with Explain /
 * Open theater / Next — the control room for a 90-second demo.
 */
export function GuidedWalkthrough({ outcomes }: { outcomes: readonly ScenarioOutcome[] }) {
  const [step, setStep] = useState(0);
  const current = outcomes[step];
  if (!current) {
    return null;
  }

  const explain = EXPLAIN[current.id] ?? {
    title: current.id,
    body: "A seeded ledger scenario.",
  };
  const isLast = step >= outcomes.length - 1;
  const expectedRefusal = isExpectedRejection(current);

  return (
    <section
      className="space-y-4 rounded-none border border-primary/30 bg-primary/5 p-4"
      data-testid="guided-walkthrough"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Demo walkthrough</h3>
        <span className="text-xs text-muted-foreground">
          Step {step + 1} of {outcomes.length}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{explain.title}</p>
          {current.outcome === "posted" ? (
            <Badge variant="muted">posted</Badge>
          ) : expectedRefusal ? (
            <Badge variant="outline">refused as expected</Badge>
          ) : (
            <Badge variant="destructive">{current.reason ?? "rejected"}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{explain.body}</p>
        {expectedRefusal ? (
          <p className="text-sm text-foreground">
            Celebrate this refusal — it is invariant #6 working. Check Audit → Rejections for the
            recorded reason.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {current.transactionId ? (
          <Button
            variant="default"
            size="sm"
            render={
              <Link
                to="/transactions/$transactionId"
                params={{ transactionId: current.transactionId }}
                search={{ play: true }}
              />
            }
          >
            Open theater
          </Button>
        ) : (
          <Button variant="outline" size="sm" render={<Link to="/audit" />}>
            Open rejections
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isLast}
          onClick={() => setStep((s) => Math.min(outcomes.length - 1, s + 1))}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
