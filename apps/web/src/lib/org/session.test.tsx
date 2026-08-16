import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { switchOrganization } from "./session";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: { setActive: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    signOut: vi.fn().mockResolvedValue({ data: {}, error: null }),
  },
}));

/**
 * Stands in for the integrity seal: an org-scoped query that stays mounted
 * across an organization switch because it lives in the persistent shell.
 * `activeOrg` plays the server — the same query key returns whatever the
 * session's active org is at fetch time, exactly like every ledger procedure
 * (no procedure takes an `orgId`, so org A and org B share cache keys).
 */
function MountedSeal({ readActiveOrg }: { readActiveOrg: () => string }) {
  const query = useQuery({
    queryKey: ["reconciliation", "verify"],
    queryFn: async () => `verified:${readActiveOrg()}`,
    staleTime: 30_000,
  });
  return <output>{query.data ?? "pending"}</output>;
}

describe("switchOrganization", () => {
  it("refetches queries that stay mounted through the switch", async () => {
    // The regression: `queryClient.clear()` removes queries but does not
    // refetch actively-observed ones, so a mounted component keeps rendering
    // the removed query's last result — the stale "Verified · 6 accounts".
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let activeOrg = "org-a";

    render(
      <QueryClientProvider client={queryClient}>
        <MountedSeal readActiveOrg={() => activeOrg} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("verified:org-a"));

    activeOrg = "org-b";
    await switchOrganization("org-b", queryClient, () => {});

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("verified:org-b"));
  });

  it("leaves no unmounted query holding the previous organization's data", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["accounts", "list"], { accounts: ["org-a balances"] });

    await switchOrganization("org-b", queryClient, () => {});

    expect(queryClient.getQueryData(["accounts", "list"])).toBeUndefined();
  });
});
