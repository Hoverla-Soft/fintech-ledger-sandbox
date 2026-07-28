import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { Separator } from "@fintech-ledger-sandbox/ui/components/separator";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { QueryState } from "@/components/states";
import {
  AccountBalance,
  AccountStatusBadge,
  AccountTypeBadge,
  isSuspenseAccount,
} from "@/features/accounts/account-display";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/accounts/$accountId")({
  component: AccountDetailRoute,
});

/**
 * One account.
 *
 * A `404` here means one of two things and the console cannot tell them apart:
 * the id does not exist, or it belongs to another organization. That is
 * deliberate — `packages/api/src/routers/accounts.ts` collapses both into a
 * byte-identical `AccountNotFound` so the endpoint cannot be used to probe
 * another tenant's ids. The copy therefore says "not in this organization",
 * which is true either way and implies nothing about the other case.
 */
function AccountDetailRoute() {
  const { accountId } = Route.useParams();
  const account = useQuery(orpc.accounts.get.queryOptions({ input: { accountId } }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button variant="outline" size="sm" render={<Link to="/accounts" />}>
        ← All accounts
      </Button>

      <QueryState query={account} loadingRows={4}>
        {(data) => (
          <div className="space-y-4 rounded-none border p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{data.name}</h1>
                {isSuspenseAccount(data) ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Opened automatically by a sandbox reset to hold a partially unwound balance.
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <AccountTypeBadge type={data.type} />
                <AccountStatusBadge active={data.active} />
              </div>
            </div>

            <Separator />

            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Balance</dt>
                <dd>
                  <AccountBalance account={data} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Currency</dt>
                <dd>{data.currency}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(data.createdAt).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-8">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono text-xs break-all">{data.id}</dd>
              </div>
            </dl>

            {data.type === "external" ? (
              <p className="text-sm text-muted-foreground">
                External accounts represent value entering or leaving the sandbox, so a negative
                balance here is expected rather than an error.
              </p>
            ) : null}
          </div>
        )}
      </QueryState>
    </div>
  );
}
