import { Tabs, TabsList, TabsPanel, TabsTab } from "@fintech-ledger-sandbox/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import {
  CursorExpiredNotice,
  PageControls,
  useCursorRecovery,
  usePageState,
} from "@/components/paging";
import { EmptyState, QueryState } from "@/components/states";
import { AuditTable } from "@/features/audit/audit-table";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/audit")({
  component: AuditRoute,
});

/** Well inside the API's `1..200` range, so the `400 {issues}` branch on `limit` is unreachable from this screen. */
const PAGE_SIZE = 50;

/**
 * The audit log and its rejections view.
 *
 * Open to both roles — both procedures sit on `orgProcedure`, and a viewer who
 * can see balances can already see everything here.
 *
 * Each tab pages independently. That is not cosmetic: `rejections` is a
 * *filtered* read of the same table, so its cursor walks the filtered sequence.
 * Sharing one cursor between the tabs would hand a position from the full log to
 * the filtered view and skip rejections — under-reporting on the one screen
 * whose entire job is "what was refused".
 */
function AuditRoute() {
  const allPaging = usePageState();
  const all = useQuery(
    orpc.audit.list.queryOptions({ input: { limit: PAGE_SIZE, ...allPaging.cursorInput } }),
  );
  useCursorRecovery(allPaging, all);

  // A separate query, not a client-side filter of `all`. Filtering the fetched
  // page would drop every rejection that fell outside it — the rejections view
  // would then under-report, which is the one thing a "what was refused" screen
  // must never do.
  const rejectionsPaging = usePageState();
  const rejections = useQuery(
    orpc.audit.rejections.queryOptions({
      input: { limit: PAGE_SIZE, ...rejectionsPaging.cursorInput },
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
                  title="Nothing recorded yet"
                  description="Posting or refusing a transaction writes an entry here."
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
                  title="Nothing has been refused"
                  description="No transaction in this organization has been rejected. That is good news."
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

/**
 * The one thing a reader would still get wrong.
 *
 * The 200-entry ceiling caveat that used to sit here is gone: Phase 7a gave
 * both procedures a cursor, so the log genuinely is walkable to its end and
 * saying otherwise would now be the inaccurate statement.
 *
 * Account creation is a different matter. `accounts.create` writes **no** audit
 * entry (`docs/adr/0006-write-endpoint-contract.md`), so a log described as
 * "everything that happened" reads as evidence that no account was created,
 * which is false.
 */
function AccountCreationCaveat() {
  return (
    <p className="text-xs text-muted-foreground">
      Creating an account is not recorded here — only transactions and refusals are.
    </p>
  );
}
