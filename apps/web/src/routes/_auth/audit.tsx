import { Tabs, TabsList, TabsPanel, TabsTab } from "@fintech-ledger-sandbox/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, QueryState } from "@/components/states";
import { AuditTable } from "@/features/audit/audit-table";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/audit")({
  component: AuditRoute,
});

/**
 * Well inside the API's `1..200` range, so the `400 {issues}` branch on
 * `limit` is unreachable from this screen — and equal to the ceiling, so the
 * screen shows everything the endpoint can return.
 */
const LIMIT = 200;

/**
 * The audit log and its rejections view.
 *
 * Open to both roles — both procedures sit on `orgProcedure`, and a viewer who
 * can see balances can already see everything here.
 */
function AuditRoute() {
  const all = useQuery(orpc.audit.list.queryOptions({ input: { limit: LIMIT } }));
  // A separate query, not a client-side filter of `all`. Filtering the capped
  // list would silently drop rejections that fell outside the most recent 200
  // entries — the rejections view would then under-report, which is the one
  // thing a "what was refused" screen must never do.
  const rejections = useQuery(orpc.audit.rejections.queryOptions({ input: { limit: LIMIT } }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every transaction this organization posted, and every one it refused.
        </p>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTab value="all">All entries</TabsTab>
          <TabsTab value="rejections">Rejections</TabsTab>
        </TabsList>

        <TabsPanel value="all">
          <QueryState
            query={all}
            loadingRows={8}
            empty={{
              isEmpty: (data) => data.entries.length === 0,
              render: (
                <EmptyState
                  title="Nothing recorded yet"
                  description="Posting or refusing a transaction writes an entry here."
                  action={<span className="text-sm text-muted-foreground">Post a transfer to see it appear.</span>}
                />
              ),
            }}
          >
            {(data) => (
              <div className="space-y-3">
                <AuditTable entries={data.entries} />
                <Caveats count={data.entries.length} />
              </div>
            )}
          </QueryState>
        </TabsPanel>

        <TabsPanel value="rejections">
          <QueryState
            query={rejections}
            loadingRows={5}
            empty={{
              isEmpty: (data) => data.entries.length === 0,
              render: (
                <EmptyState
                  title="Nothing has been refused"
                  description="No transaction in this organization has been rejected. That is good news."
                  action={<span className="text-sm text-muted-foreground">Refusals appear here automatically.</span>}
                />
              ),
            }}
          >
            {(data) => (
              <div className="space-y-3">
                <AuditTable entries={data.entries} />
                <p className="text-xs text-muted-foreground">
                  Repeated identical refusals are expected — re-running the sandbox scenarios appends
                  another rejection entry each time.
                </p>
                <Caveats count={data.entries.length} />
              </div>
            )}
          </QueryState>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

/**
 * Two things a reader would otherwise get wrong.
 *
 * The ceiling: there is no cursor on these endpoints, so the log genuinely is
 * not walkable past its most recent 200 entries. Someone who believes they are
 * seeing everything will draw wrong conclusions from an incomplete log.
 *
 * And account creation: `accounts.create` writes **no** audit entry
 * (`docs/adr/0006-write-endpoint-contract.md`). A log described as "everything
 * that happened" reads as evidence that no account was created, which is false.
 */
function Caveats({ count }: { count: number }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {count >= LIMIT ? (
        <p>
          Showing the most recent {LIMIT} entries — the maximum this endpoint returns. Older entries
          exist but cannot be paged to yet.
        </p>
      ) : (
        <p>Showing all {count} {count === 1 ? "entry" : "entries"} (maximum {LIMIT}).</p>
      )}
      <p>Creating an account is not recorded here — only transactions and refusals are.</p>
    </div>
  );
}
