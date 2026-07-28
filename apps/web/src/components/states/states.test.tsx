import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmptyState, ErrorState, LoadingRows, QueryState } from "./index";

/** Shapes an oRPC error the way the client surfaces it. */
function orpcError(code: string, status: number, data: Record<string, unknown> = {}) {
  return { code, status, message: "A fixed server string the console must never render.", data };
}

/** A query object in one of TanStack Query's four observable shapes. */
function query<T>(state: Partial<Parameters<typeof QueryState<T>>[0]["query"]>) {
  return {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: undefined as T | undefined,
    refetch: vi.fn(),
    ...state,
  };
}

describe("LoadingRows", () => {
  it("announces itself to assistive technology rather than rendering silent boxes", () => {
    render(<LoadingRows rows={3} />);
    expect(screen.getByTestId("loading-state")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders the mapped copy and never the server's message", () => {
    render(<ErrorState error={orpcError("UNPROCESSABLE_CONTENT", 422, { reason: "insufficient_funds" })} />);
    expect(screen.getByText("Not enough funds")).toBeInTheDocument();
    expect(screen.queryByText(/fixed server string/)).not.toBeInTheDocument();
  });

  it("retries when asked", async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new TypeError("Failed to fetch")} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("surfaces the retry-after window from a throttled response body", () => {
    render(
      <ErrorState
        error={orpcError("TOO_MANY_REQUESTS", 429, { reason: "rate_limited", retryAfterSeconds: 12 })}
      />,
    );
    expect(screen.getByText(/about 12 seconds/)).toBeInTheDocument();
  });

  it("is announced as an alert", () => {
    render(<ErrorState error={orpcError("INTERNAL_SERVER_ERROR", 500)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("QueryState precedence", () => {
  it("renders the error state, not the empty state, when a query fails", () => {
    // The bug this exists to prevent: a failed query has `data === undefined`,
    // so an empty-first branch renders "nothing here yet" for a server that is
    // down. In a ledger those mean opposite things — one invites you to create
    // an account, the other means the balances on screen may be nothing at all.
    render(
      <QueryState
        query={query<{ items: string[] }>({ isError: true, error: new Error("boom") })}
        empty={{ isEmpty: (data) => data.items.length === 0, render: <p>NOTHING YET</p> }}
      >
        {(data) => <p>{data.items.length} items</p>}
      </QueryState>,
    );

    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.queryByText("NOTHING YET")).not.toBeInTheDocument();
  });

  it("renders the empty state only when the query genuinely succeeded with no rows", () => {
    render(
      <QueryState
        query={query<{ items: string[] }>({ data: { items: [] } })}
        empty={{ isEmpty: (data) => data.items.length === 0, render: <p>NOTHING YET</p> }}
      >
        {(data) => <p>{data.items.length} items</p>}
      </QueryState>,
    );

    expect(screen.getByText("NOTHING YET")).toBeInTheDocument();
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
  });

  it("renders the skeleton while pending, and neither empty nor error", () => {
    render(
      <QueryState
        query={query<{ items: string[] }>({ isPending: true })}
        empty={{ isEmpty: (data) => data.items.length === 0, render: <p>NOTHING YET</p> }}
      >
        {(data) => <p>{data.items.length} items</p>}
      </QueryState>,
    );

    expect(screen.getByTestId("loading-state")).toBeInTheDocument();
    expect(screen.queryByText("NOTHING YET")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
  });

  it("renders children when data is present", () => {
    render(
      <QueryState query={query<{ items: string[] }>({ data: { items: ["a", "b"] } })}>
        {(data) => <p>{data.items.length} items</p>}
      </QueryState>,
    );
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("treats settled-but-undefined as an error rather than as empty", () => {
    render(
      <QueryState query={query<{ items: string[] }>({ data: undefined })}>
        {(data) => <p>{data.items.length} items</p>}
      </QueryState>,
    );
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("always carries a next action", () => {
    render(
      <EmptyState title="No accounts yet" description="Create one." action={<button>Create</button>} />,
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("is visually distinguishable from the error state by test id and role", () => {
    const { unmount } = render(
      <EmptyState title="No accounts yet" description="Create one." action={<button>Create</button>} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    render(<ErrorState error={new Error("boom")} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
