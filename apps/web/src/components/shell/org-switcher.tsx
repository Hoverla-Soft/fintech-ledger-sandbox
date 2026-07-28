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
import { Building2, Check, ChevronsUpDown } from "lucide-react";
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
    // Sized to the control it stands in for, so the top bar does not reflow
    // when the organization resolves.
    return <Skeleton className="h-8 w-40" />;
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
        <Building2
          className="hidden size-3.5 shrink-0 text-muted-foreground sm:block"
          aria-hidden="true"
        />
        <span className="sr-only">Organization:</span>
        <span className="max-w-[8ch] truncate sm:max-w-[12ch]">
          {org?.name ?? "No organization"}
        </span>
        {/* Dropped below sm: the name is the identifier, the role is reference. */}
        <span className="hidden text-xs text-muted-foreground sm:inline">{role}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
              <span className="flex-1">{candidate.name}</span>
              {candidate.id === org?.id ? (
                <>
                  <span className="sr-only">Current organization</span>
                  <Check className="size-3.5" aria-hidden="true" />
                </>
              ) : null}
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
