import { describe, expect, it } from "vitest";

import type { WirePosting } from "@/features/transactions/postings-table";

import { conservationProgress } from "./conservation";

function posting(
  id: string,
  direction: "debit" | "credit",
  amount: string,
  accountId = "acc",
): WirePosting {
  return {
    id,
    accountId,
    direction,
    amount: { amount, currency: "USD" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("conservationProgress", () => {
  const legs = [posting("1", "debit", "10.00", "a"), posting("2", "credit", "10.00", "b")];

  it("starts empty before any leg is revealed", () => {
    expect(conservationProgress({ postings: legs, revealedCount: 0 })).toMatchObject({
      percent: 0,
      balanced: false,
    });
  });

  it("is not balanced mid-reveal even when one side is complete", () => {
    expect(conservationProgress({ postings: legs, revealedCount: 1 }).balanced).toBe(false);
    expect(conservationProgress({ postings: legs, revealedCount: 1 }).percent).toBe(50);
  });

  it("reaches 100% and balanced when every leg is on stage", () => {
    expect(conservationProgress({ postings: legs, revealedCount: 2 })).toMatchObject({
      percent: 100,
      balanced: true,
      debitTotal: "10.00",
      creditTotal: "10.00",
      currency: "USD",
    });
  });
});
