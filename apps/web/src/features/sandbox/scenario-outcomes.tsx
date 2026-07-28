import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fintech-ledger-sandbox/ui/components/table";
import { Link } from "@tanstack/react-router";

export interface ScenarioOutcome {
  readonly id: string;
  readonly outcome: "posted" | "rejected";
  readonly transactionId: string | null;
  readonly reason: string | null;
}

/**
 * Scenarios that are *supposed* to be refused.
 *
 * The seed set deliberately includes a transfer the ledger must reject — it is
 * how the sandbox demonstrates invariant #6 and gives `audit.rejections` real
 * data to serve (`docs/backend/api-flow.md`). Rendering that in red as a
 * failure would report the suite as broken when it is behaving exactly as
 * designed.
 */
const EXPECTED_REJECTIONS = new Set(["insufficient_funds"]);

export function isExpectedRejection(outcome: ScenarioOutcome): boolean {
  return outcome.outcome === "rejected" && outcome.reason !== null && EXPECTED_REJECTIONS.has(outcome.reason);
}

export function ScenarioOutcomes({ outcomes }: { outcomes: readonly ScenarioOutcome[] }) {
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scenario</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Transaction</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outcomes.map((outcome) => (
            <TableRow key={outcome.id}>
              <TableCell className="font-mono text-xs">{outcome.id}</TableCell>
              <TableCell>
                <OutcomeBadge outcome={outcome} />
              </TableCell>
              <TableCell>
                {outcome.transactionId ? (
                  <Link
                    to="/transactions/$transactionId"
                    params={{ transactionId: outcome.transactionId }}
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {outcome.transactionId.slice(0, 8)}…
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">
        One scenario is designed to be refused — it proves a normal account cannot go negative, and
        gives the rejections log real data. Re-running appends another rejection entry each time.
      </p>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: ScenarioOutcome }) {
  if (outcome.outcome === "posted") {
    return <Badge variant="muted">posted</Badge>;
  }
  if (isExpectedRejection(outcome)) {
    // Distinct from both "posted" and a genuine failure: this is the scenario
    // succeeding at being refused.
    return <Badge variant="outline">refused as expected</Badge>;
  }
  return <Badge variant="destructive">{outcome.reason ?? "rejected"}</Badge>;
}
