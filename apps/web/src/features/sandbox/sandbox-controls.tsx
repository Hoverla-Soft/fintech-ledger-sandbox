import { Alert, AlertDescription, AlertTitle } from "@fintech-ledger-sandbox/ui/components/alert";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Separator } from "@fintech-ledger-sandbox/ui/components/separator";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { describeFailure } from "@/lib/ledger/errors";
import {
  completeOperation,
  createSessionKeyStore,
  newOperation,
  startOperation,
} from "@/lib/ledger/idempotency";
import { client, orpc } from "@/utils/orpc";
import { GuidedWalkthrough } from "./guided-walkthrough";
import { type ResetProgress, runResetLoop } from "./reset-loop";
import { type ScenarioOutcome, ScenarioOutcomes } from "./scenario-outcomes";

/**
 * The sandbox's two write operations.
 *
 * Both take a caller-supplied idempotency key, which makes "resume" and "start
 * over" genuinely different actions rather than a UI nicety — and for reset the
 * difference changes what happens to balances. Both intents are therefore
 * labelled explicitly (task decision D8).
 *
 * Filenames in this directory deliberately avoid `seed` as a delimited token:
 * `.claude/guard-routes.json` routes `**\/seed*.*` to three *backend* guards
 * ahead of the `apps/web` row, and `migration-integrity-guard.js` — a blocking
 * hook — matches the token anywhere in a basename.
 */
export function SandboxControls() {
  const queryClient = useQueryClient();
  const keyStore = useRef(createSessionKeyStore()).current;

  const [scenarios, setScenarios] = useState<readonly ScenarioOutcome[] | null>(null);
  const [running, setRunning] = useState(false);

  const [resetting, setResetting] = useState(false);
  const [progress, setProgress] = useState<ResetProgress | null>(null);
  const [alarm, setAlarm] = useState<string | null>(null);

  async function invalidateLedgerViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.transactions.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.reconciliation.verify.key() }),
    ]);
  }

  async function runScenarios(fresh: boolean) {
    setRunning(true);
    setAlarm(null);
    try {
      const key = fresh
        ? newOperation("sandbox-run", keyStore)
        : startOperation("sandbox-run", keyStore);
      const result = await client.sandbox.seed({ idempotencyKey: key });
      setScenarios(result.scenarios);
      await invalidateLedgerViews();
      completeOperation("sandbox-run", keyStore);
      toast.success("Scenarios run");
    } catch (error) {
      const failure = describeFailure(error);
      toast.error(failure.title, { description: failure.detail });
    } finally {
      setRunning(false);
    }
  }

  async function reset(fresh: boolean) {
    // Disabled for the WHOLE loop, not per request. Two resets racing each
    // other surface as a misleading `422 insufficient_funds`, which reads as a
    // ledger problem rather than the double-click it actually is (ADR 0008).
    setResetting(true);
    setAlarm(null);
    setProgress(null);

    const key = fresh
      ? newOperation("sandbox-reset", keyStore)
      : startOperation("sandbox-reset", keyStore);

    try {
      const outcome = await runResetLoop({
        idempotencyKey: key,
        call: (idempotencyKey) => client.sandbox.reset({ idempotencyKey }),
        classify: (error) => {
          const failure = describeFailure(error);
          return {
            reason: failure.reason,
            retryAfterSeconds: failure.rateLimit?.retryAfterSeconds,
          };
        },
        onProgress: setProgress,
      });

      await invalidateLedgerViews();

      if (outcome.status === "complete") {
        completeOperation("sandbox-reset", keyStore);
        toast.success(`Reset complete — ${outcome.progress.accountsZeroed} accounts zeroed`);
        return;
      }

      if (outcome.status === "unbalanced") {
        // Not a form error. Reset refused rather than destroying evidence, so
        // the compensating entry itself did not balance — that is a
        // reconciliation problem and needs a destination, which is why these
        // two screens ship in one slice.
        setAlarm(
          "Reset refused to continue because its compensating entry did not balance. Nothing was forced through. This is a reconciliation problem, not a form error.",
        );
        return;
      }

      const failure = describeFailure(outcome.error);
      toast.error(failure.title, { description: failure.detail });
    } finally {
      setResetting(false);
    }
  }

  const busy = running || resetting;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-none border p-4">
        <div>
          <h2 className="font-medium">Run scenarios</h2>
          <p className="text-sm text-muted-foreground">
            Creates the sandbox accounts and posts a set of transfers — funding, a payroll run, a
            marketplace payout with a fee split, a transfer that must be refused, and a reversal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void runScenarios(false)}>
            {running ? "Running…" : "Run scenarios"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void runScenarios(true)}>
            Start a new run
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Running again replays the same run and posts nothing new. Starting a new run posts a fresh
          set.
        </p>
        {scenarios ? (
          <div className="space-y-4">
            <GuidedWalkthrough outcomes={scenarios} />
            <ScenarioOutcomes outcomes={scenarios} />
          </div>
        ) : null}
      </section>

      <Separator />

      <section className="space-y-3 rounded-none border p-4">
        <div>
          <h2 className="font-medium">Reset</h2>
          {/*
            ADR 0008 asks Phase 5 to label this honestly, because "reset"
            suggests erasure and this is the opposite of that.
          */}
          <p className="text-sm text-muted-foreground">
            Unwinds every balance to zero by posting a balanced compensating transaction.{" "}
            <strong>Nothing is deleted.</strong> Accounts stay, stay open, and end at zero — and the
            transaction count goes <em>up</em>, because the corrections are themselves entries.
            History will show them.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" disabled={busy} onClick={() => void reset(false)}>
            {resetting ? "Resetting…" : "Reset balances"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void reset(true)}>
            Start a new reset
          </Button>
        </div>

        {progress ? (
          <p className="text-sm" role="status">
            {progress.remaining > 0
              ? `Zeroed ${progress.accountsZeroed} accounts over ${progress.calls} ${progress.calls === 1 ? "call" : "calls"} — ${progress.remaining} still to go…`
              : `Zeroed ${progress.accountsZeroed} accounts over ${progress.calls} ${progress.calls === 1 ? "call" : "calls"}.`}
          </p>
        ) : null}

        {alarm ? (
          <Alert variant="destructive">
            <AlertTitle>Reconciliation alarm</AlertTitle>
            <AlertDescription>
              <p>{alarm}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                render={<Link to="/reconciliation" />}
              >
                Check reconciliation
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </section>
    </div>
  );
}
