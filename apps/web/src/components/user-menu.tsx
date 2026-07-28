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
import { Link, useNavigate, useRouter } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { signOutAndClear } from "@/lib/org/session";

export default function UserMenu() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Link to="/login">
        <Button variant="outline">Sign In</Button>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              // Clearing the cache is the load-bearing part, and it was missing
              // before Phase 5b: signing out navigated away but left every
              // org-scoped response resident, so the next user to sign in on
              // this tab could be served the previous user's balances out of
              // cache before their own first refetch resolved.
              void signOutAndClear(queryClient, () => router.invalidate()).then(() =>
                navigate({ to: "/" }),
              );
            }}
          >
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
