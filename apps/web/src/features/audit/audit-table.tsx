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

import {
  actionLabel,
  formatMetadata,
  isExpectedRefusal,
  type WireAuditEntry,
} from "./entry-display";

export function AuditTable({
  entries,
}: {
  entries: readonly WireAuditEntry[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const metadata = formatMetadata(entry.metadata);
          return (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleString()}
              </TableCell>
              <TableCell
                className="max-w-32 truncate font-mono text-xs"
                title={entry.actorUserId}
              >
                {entry.actorUserId.slice(0, 8)}…
              </TableCell>
              <TableCell>
                <div>{actionLabel(entry.action)}</div>
                {metadata ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      metadata
                    </summary>
                    <pre className="mt-1 max-w-xs overflow-x-auto rounded-none border p-2 text-xs">
                      {metadata}
                    </pre>
                  </details>
                ) : null}
              </TableCell>
              <TableCell>
                <OutcomeCell entry={entry} />
              </TableCell>
              <TableCell>
                {entry.transactionId ? (
                  <Link
                    to="/transactions/$transactionId"
                    params={{ transactionId: entry.transactionId }}
                    search={{ play: true }}
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {entry.transactionId.slice(0, 8)}…
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function OutcomeCell({ entry }: { entry: WireAuditEntry }) {
  if (entry.outcome === "posted") {
    return <Badge variant="muted">posted</Badge>;
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={isExpectedRefusal(entry) ? "outline" : "destructive"}>
        {entry.reason ?? "rejected"}
      </Badge>
      {isExpectedRefusal(entry) ? (
        <span className="text-xs text-muted-foreground">expected refusal</span>
      ) : null}
    </div>
  );
}
