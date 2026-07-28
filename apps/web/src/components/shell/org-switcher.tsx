import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@fintech-ledger-sandbox/ui/components/dropdown-menu";
import { Skeleton } from "@fintech-ledger-sandbox/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { describeFailure } from "@/lib/ledger/errors";
import { switchOrganization, useOrganizations, useOrgContext } from "@/lib/org/session";

/**
 * Switches the acting organization.
 *
 * This control is what makes the product's headline claim demonstrable: with
 * one org you cannot show that org A's accounts are invisible to org B, and
 * tenant isolation is the thing this whole sandbox exists to prove.
 *
 * The switch itself lives in `lib/org/session.ts` because it does more than
 * call Better Auth — it must clear the query cache, and forgetting that
 * renders the previous tenant's balances from cache under the new org's name.
 */
export function OrgSwitcher() {
  const { org, role, isPending } = useOrgContext();
  const { data: organizations } = useOrganizations();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  if (isPending) {
    return <Skeleton className="h-9 w-40" />;
  }

  async function onSwitch(organizationId: string) {
    if (organizationId === org?.id) {
      return;
    }
    setSwitching(true);
    try {
      await switchOrganization(organizationId, queryClient, () => router.invalidate());
      toast.success("Switched organization");
    } catch (error) {
      const failure = describeFailure(error);
      toast.error(failure.title, { description: failure.detail });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={switching} />}>
        {org?.name ?? "No organization"}
        <span className="ml-2 text-xs text-muted-foreground">{role}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(organizations ?? []).map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              onClick={() => {
                void onSwitch(candidate.id);
              }}
            >
              {candidate.name}
              {candidate.id === org?.id ? " ✓" : ""}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link to="/organization" />}>
            Manage organizations
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
