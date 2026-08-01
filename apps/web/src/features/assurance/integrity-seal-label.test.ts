import { describe, expect, it } from "vitest";

import { integritySealLabel } from "./integrity-seal-label";

describe("integritySealLabel", () => {
  it("names a clean ledger with the account count", () => {
    expect(integritySealLabel({ allReconciled: true, accountCount: 4, unreconciledCount: 0 })).toBe(
      "Verified · 4 accounts",
    );
  });

  it("singularises one account", () => {
    expect(integritySealLabel({ allReconciled: true, accountCount: 1, unreconciledCount: 0 })).toBe(
      "Verified · 1 account",
    );
  });

  it("reports drift counts when the ledger is not clean", () => {
    expect(
      integritySealLabel({ allReconciled: false, accountCount: 10, unreconciledCount: 2 }),
    ).toBe("Drift · 2 of 10");
  });

  it("compacts for the mobile chrome", () => {
    expect(
      integritySealLabel({
        allReconciled: true,
        accountCount: 4,
        unreconciledCount: 0,
        compact: true,
      }),
    ).toBe("Verified");
    expect(
      integritySealLabel({
        allReconciled: false,
        accountCount: 10,
        unreconciledCount: 2,
        compact: true,
      }),
    ).toBe("Drift");
  });
});
