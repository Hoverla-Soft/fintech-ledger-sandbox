import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PostingsTable, sumByDirection, type WirePosting } from "./postings-table";

function posting(overrides: Partial<WirePosting> = {}): WirePosting {
  return {
    id: "p-1",
    accountId: "acc-1",
    direction: "debit",
    amount: { amount: "12.50", currency: "USD" },
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("sumByDirection", () => {
  it("sums a balanced two-leg transaction to equal totals", () => {
    const totals = sumByDirection([
      posting({ id: "a", direction: "debit" }),
      posting({ id: "b", direction: "credit" }),
    ]);
    expect(totals.debits).toBe(1250n);
    expect(totals.credits).toBe(1250n);
  });

  it("sums an N-leg split correctly", () => {
    const totals = sumByDirection([
      posting({ id: "a", direction: "debit", amount: { amount: "950.00", currency: "USD" } }),
      posting({ id: "b", direction: "debit", amount: { amount: "50.00", currency: "USD" } }),
      posting({ id: "c", direction: "credit", amount: { amount: "1000.00", currency: "USD" } }),
    ]);
    expect(totals.debits).toBe(totals.credits);
    expect(totals.debits).toBe(100000n);
  });

  it("rescales legs written at different widths before summing", () => {
    // The false-pass trap: "1.0" and "10" both reduce to the digits `10`, so
    // an unscaled sum reports these as balanced when they differ by nine
    // units. Same bug class that had to be fixed in the 5a kernel.
    const totals = sumByDirection([
      posting({ id: "a", direction: "debit", amount: { amount: "1.0", currency: "USD" } }),
      posting({ id: "b", direction: "credit", amount: { amount: "10", currency: "USD" } }),
    ]);
    expect(totals.debits).not.toBe(totals.credits);
  });

  it("treats genuinely-equal legs written at different widths as equal", () => {
    const totals = sumByDirection([
      posting({ id: "a", direction: "debit", amount: { amount: "1.0", currency: "USD" } }),
      posting({ id: "b", direction: "credit", amount: { amount: "1.00", currency: "USD" } }),
    ]);
    expect(totals.debits).toBe(totals.credits);
  });

  it("handles a zero-exponent currency without inventing decimals", () => {
    const totals = sumByDirection([
      posting({ id: "a", direction: "debit", amount: { amount: "1250", currency: "JPY" } }),
      posting({ id: "b", direction: "credit", amount: { amount: "1250", currency: "JPY" } }),
    ]);
    expect(totals.debits).toBe(1250n);
    expect(totals.scale).toBe(0);
  });
});

describe("PostingsTable", () => {
  const names = new Map([
    ["acc-1", "Operating"],
    ["acc-2", "Employee A"],
  ]);

  it("renders the net-to-zero proof for a balanced transaction", () => {
    render(
      <PostingsTable
        postings={[
          posting({ id: "a", accountId: "acc-2", direction: "debit" }),
          posting({ id: "b", accountId: "acc-1", direction: "credit" }),
        ]}
        accountNames={names}
      />,
    );
    expect(screen.getByTestId("net-to-zero-proof")).toBeInTheDocument();
    expect(screen.getByText("Nets to zero")).toBeInTheDocument();
  });

  it("says so loudly when the legs do not balance", () => {
    // Should be unreachable from real data — the server refuses to persist an
    // unbalanced transaction — so if it ever renders, it is a reconciliation
    // alarm and must not be quiet.
    render(
      <PostingsTable
        postings={[
          posting({ id: "a", direction: "debit", amount: { amount: "1.00", currency: "USD" } }),
          posting({ id: "b", direction: "credit", amount: { amount: "0.99", currency: "USD" } }),
        ]}
        accountNames={names}
      />,
    );
    expect(screen.getByText("Does not balance")).toBeInTheDocument();
  });

  it("renders account names rather than ids when it can", () => {
    render(
      <PostingsTable
        postings={[
          posting({ id: "a", accountId: "acc-1" }),
          posting({ id: "b", accountId: "acc-2", direction: "credit" }),
        ]}
        accountNames={names}
      />,
    );
    expect(screen.getByText("Operating")).toBeInTheDocument();
    expect(screen.getByText("Employee A")).toBeInTheDocument();
  });

  it("falls back to the id rather than rendering nothing for an unknown account", () => {
    render(
      <PostingsTable
        postings={[posting({ id: "a", accountId: "unknown-id" })]}
        accountNames={names}
      />,
    );
    expect(screen.getByText("unknown-id")).toBeInTheDocument();
  });

  it("places amounts in debit and credit columns", () => {
    render(
      <PostingsTable
        postings={[
          posting({ id: "a", direction: "debit", amount: { amount: "12.50", currency: "USD" } }),
          posting({ id: "b", direction: "credit", amount: { amount: "12.50", currency: "USD" } }),
        ]}
        accountNames={names}
      />,
    );
    expect(screen.getByText("Debit")).toBeInTheDocument();
    expect(screen.getByText("Credit")).toBeInTheDocument();
    // Two legs + matching totals row cells.
    expect(screen.getAllByText("12.50 USD")).toHaveLength(4);
    expect(screen.getByText("Nets to zero")).toBeInTheDocument();
  });
});
