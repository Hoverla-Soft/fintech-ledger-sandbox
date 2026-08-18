import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Input } from "@fintech-ledger-sandbox/ui/components/input";
import { Label } from "@fintech-ledger-sandbox/ui/components/label";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@fintech-ledger-sandbox/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  CursorExpiredNotice,
  PageControls,
  useCursorRecovery,
  usePageState,
} from "@/components/paging";
import { EmptyState, QueryState } from "@/components/states";
import { AuditTable } from "@/features/audit/audit-table";
import { actionLabel, type WireAuditEntry } from "@/features/audit/entry-display";
import { downloadCsv } from "@/lib/export/csv";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/audit")({
  component: AuditRoute,
});

const PAGE_SIZE = 50;

function exportEntries(filename: string, entries: readonly WireAuditEntry[]) {
  downloadCsv(
    filename,
    ["id", "createdAt", "actorUserId", "action", "outcome", "reason", "transactionId"],
    entries.map((entry) => [
      entry.id,
      entry.createdAt,
      entry.actorUserId,
      actionLabel(entry.action),
      entry.outcome,
      entry.reason ?? "",
      entry.transactionId ?? "",
    ]),
  );
}

function AuditRoute() {
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const filters = useMemo(
    () => ({
      ...(action.trim() ? { action: action.trim() } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
    [action, reason],
  );

  const allPaging = usePageState();
  const rejectionsPaging = usePageState();

  useEffect(() => {
    allPaging.reset();
    rejectionsPaging.reset();
  }, [filters, allPaging.reset, rejectionsPaging.reset]);

  const all = useQuery(
    orpc.audit.list.queryOptions({
      input: { limit: PAGE_SIZE, ...allPaging.cursorInput, ...filters },
    }),
  );
  useCursorRecovery(allPaging, all);

  const rejections = useQuery(
    orpc.audit.rejections.queryOptions({
      input: { limit: PAGE_SIZE, ...rejectionsPaging.cursorInput, ...filters },
    }),
  );
  useCursorRecovery(rejectionsPaging, rejections);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every transaction this organization posted, and every one it refused. Newest first.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <Input
            id="audit-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. post_transaction"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-reason">Reason</Label>
          <Input
            id="audit-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. insufficient_funds"
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Filters apply server-side. Exact match on the stored action / reason codes.
      </p>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTab value="all">All entries</TabsTab>
          <TabsTab value="rejections">Rejections</TabsTab>
        </TabsList>

        <TabsPanel value="all">
          <CursorExpiredNotice show={allPaging.cursorExpired} />
          <QueryState
            query={all}
            loadingRows={8}
            empty={{
              isEmpty: (data) => data.entries.length === 0 && !hasPrevious(allPaging.page),
              render: (
                <EmptyState
                  title="No matching entries"
                  description="Widen the filters, or post a transfer to see activity."
                  action={
                    <span className="text-sm text-muted-foreground">
                      Post a transfer to see it appear.
                    </span>
                  }
                />
              ),
            }}
          >
            {(data) => (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={data.entries.length === 0}
                    onClick={() => exportEntries("audit.csv", data.entries)}
                  >
                    Export CSV
                  </Button>
                </div>
                <AuditTable entries={data.entries} />
                <PageControls
                  paging={allPaging}
                  nextCursor={data.nextCursor}
                  isFetching={all.isFetching}
                />
                <AccountCreationCaveat />
              </div>
            )}
          </QueryState>
        </TabsPanel>

        <TabsPanel value="rejections">
          <CursorExpiredNotice show={rejectionsPaging.cursorExpired} />
          <QueryState
            query={rejections}
            loadingRows={5}
            empty={{
              isEmpty: (data) => data.entries.length === 0 && !hasPrevious(rejectionsPaging.page),
              render: (
                <EmptyState
                  title="No matching refusals"
                  description="No rejected attempts match these filters."
                  action={
                    <span className="text-sm text-muted-foreground">
                      Refusals appear here automatically.
                    </span>
                  }
                />
              ),
            }}
          >
            {(data) => (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={data.entries.length === 0}
                    onClick={() => exportEntries("rejections.csv", data.entries)}
                  >
                    Export CSV
                  </Button>
                </div>
                <AuditTable entries={data.entries} />
                <PageControls
                  paging={rejectionsPaging}
                  nextCursor={data.nextCursor}
                  isFetching={rejections.isFetching}
                />
                <p className="text-xs text-muted-foreground">
                  Repeated identical refusals are expected — re-running the sandbox scenarios
                  appends another rejection entry each time.
                </p>
                <AccountCreationCaveat />
              </div>
            )}
          </QueryState>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

function AccountCreationCaveat() {
  return (
    <p className="text-xs text-muted-foreground">
      Creating an account is not recorded here. Closing or reopening one is — it changes whether
      money can move, which is the line this log draws.
    </p>
  );
}
