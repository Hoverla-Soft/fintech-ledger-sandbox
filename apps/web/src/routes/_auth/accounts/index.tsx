import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@fintech-ledger-sandbox/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import {
  CursorExpiredNotice,
  PageControls,
  useCursorRecovery,
  usePageState,
} from "@/components/paging";
import { QueryState } from "@/components/states";
import {
  AccountBalance,
  AccountStatusBadge,
  AccountTypeBadge,
  isSuspenseAccount,
} from "@/features/accounts/account-display";
import { CreateAccountDialog } from "@/features/accounts/create-account-dialog";
import { useOrgContext } from "@/lib/org/session";
import { hasPrevious } from "@/lib/pagination";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/accounts/")({
  component: AccountsRoute,
});

/** Well inside the API's `1..200` range, so the `400 {issues}` branch on `limit` is unreachable from this screen. */
const PAGE_SIZE = 25;

function AccountsRoute() {
  const paging = usePageState();
  const accounts = useQuery(
    orpc.accounts.list.queryOptions({ input: { limit: PAGE_SIZE, ...paging.cursorInput } }),
  );
  useCursorRecovery(paging, accounts);
  const { canWrite } = useOrgContext();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Every account belongs to this organization and is invisible to every other.
          </p>
        </div>
        {/*
          Hidden for viewers as a courtesy, never as enforcement. The role is
          derived client-side from a session Better Auth may have cached
          (ADR 0009) and can be revoked mid-session, so the mutation still
          handles `403 insufficient_role` on its own.
        */}
        {canWrite ? <CreateAccountDialog /> : null}
      </div>

      <CursorExpiredNotice show={paging.cursorExpired} />

      <QueryState
        query={accounts}
        loadingRows={5}
        empty={{
          // Only page one can be empty in the "this org has nothing" sense.
          // An empty later page means the walk ran off the end, and offering
          // "create your first account" there would be nonsense.
          isEmpty: (data) => data.accounts.length === 0 && !hasPrevious(paging.page),
          render: <EmptyAccounts canWrite={canWrite} />,
        }}
      >
        {(data) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <Link
                        to="/accounts/$accountId"
                        params={{ accountId: account.id }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {account.name}
                      </Link>
                      {isSuspenseAccount(account) ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          opened automatically by a sandbox reset
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <AccountTypeBadge type={account.type} />
                    </TableCell>
                    <TableCell>{account.currency}</TableCell>
                    <TableCell className="text-right">
                      <AccountBalance account={account} />
                    </TableCell>
                    <TableCell>
                      <AccountStatusBadge active={account.active} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <PageControls
              paging={paging}
              nextCursor={data.nextCursor}
              isFetching={accounts.isFetching}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}

/**
 * The empty state's action depends on the role: telling a viewer to "create an
 * account" points them at a button they do not have.
 */
function EmptyAccounts({ canWrite }: { canWrite: boolean }) {
  return (
    <div className="rounded-none border border-dashed p-12 text-center" data-testid="empty-state">
      <p className="font-medium">No accounts yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        An account is a named balance in one currency.
      </p>
      <div className="mt-4 flex justify-center">
        {canWrite ? (
          <CreateAccountDialog />
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask an admin in this organization to create the first one.
          </p>
        )}
      </div>
    </div>
  );
}
