import { Badge } from "@fintech-ledger-sandbox/ui/components/badge";
import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fintech-ledger-sandbox/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  CursorExpiredNotice,
  PageControls,
  useCursorRecovery,
  usePageState,
} from "@/components/paging";
import { EmptyState, QueryState } from "@/components/states";
import { authClient } from "@/lib/auth-client";
import { describeFailure } from "@/lib/ledger/errors";
import { useOrgContext } from "@/lib/org/session";
import { hasPrevious } from "@/lib/pagination";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/approvals")({
  component: ApprovalsRoute,
});

const PAGE_SIZE = 50;

/**
 * Maker-checker queue: pending transfers awaiting a second admin.
 */
function ApprovalsRoute() {
  const { canWrite } = useOrgContext();
  const { data: session } = authClient.useSession();
  const actorId = session?.user.id ?? "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const paging = usePageState();
  const pending = useQuery(
    orpc.approvals.listPending.queryOptions({
      input: { limit: PAGE_SIZE, ...paging.cursorInput },
    }),
  );
  useCursorRecovery(paging, pending);

  const approve = useMutation({
    // No idempotency key: the server derives it from the pending row. This used
    // to mint `crypto.randomUUID()` here, which meant every click was a new
    // operation — so a double-click posted the transfer twice.
    mutationFn: (pendingId: string) => client.approvals.approve({ pendingId }),
    retry: false,
    onSuccess: async (transaction) => {
      await queryClient.invalidateQueries({ queryKey: orpc.approvals.listPending.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.accounts.list.key() });
      toast.success("Transfer approved and posted");
      await navigate({
        to: "/transactions/$transactionId",
        params: { transactionId: transaction.id },
      });
    },
    onError: (error) => {
      const failure = describeFailure(error);
      toast.error(failure.title, { description: failure.detail });
    },
  });

  const reject = useMutation({
    mutationFn: (pendingId: string) => client.approvals.reject({ pendingId }),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.approvals.listPending.key() });
      toast.success("Transfer rejected");
    },
    onError: (error) => {
      const failure = describeFailure(error);
      toast.error(failure.title, { description: failure.detail });
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Thin maker-checker: a second admin must approve before balances move. Self-approve is
          blocked.
        </p>
      </div>

      <CursorExpiredNotice show={paging.cursorExpired} />

      <QueryState
        query={pending}
        loadingRows={4}
        empty={{
          // `hasPrevious` matters here: approving the last row of page two
          // empties that page without emptying the queue, and "No pending
          // transfers" on the maker-checker screen is the one wrong answer
          // that could get a real transfer forgotten.
          isEmpty: (data) => data.pending.length === 0 && !hasPrevious(paging.page),
          render: (
            <EmptyState
              title="No pending transfers"
              description="When transfer approval is required, submissions wait here."
              action={
                <Button variant="outline" render={<Link to="/transfer" />}>
                  New transfer
                </Button>
              }
            />
          ),
        }}
      >
        {(data) => (
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Legs</TableHead>
                  <TableHead>Submitter</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pending.map((row) => {
                  const isSelf = row.createdBy === actorId;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(row.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{row.currency}</TableCell>
                      <TableCell>
                        <Badge variant="muted">{row.postings.length} postings</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.createdBy.slice(0, 8)}…
                        {isSelf ? <span className="ml-2 text-muted-foreground">(you)</span> : null}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        {canWrite ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              disabled={isSelf || approve.isPending || reject.isPending}
                              title={
                                isSelf
                                  ? "A different admin must approve"
                                  : "Approve and post to the ledger"
                              }
                              onClick={() => approve.mutate(row.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isSelf || approve.isPending || reject.isPending}
                              onClick={() => reject.mutate(row.id)}
                            >
                              Reject
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Viewer — wait</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PageControls
              paging={paging}
              nextCursor={data.nextCursor}
              isFetching={pending.isFetching}
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}
