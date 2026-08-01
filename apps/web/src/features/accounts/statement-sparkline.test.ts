import { describe, expect, it } from "vitest";

import { runningBalanceSeries } from "./statement-sparkline";

describe("runningBalanceSeries", () => {
  it("keeps the last running balance per UTC day", () => {
    const series = runningBalanceSeries([
      {
        createdAt: "2026-08-01T10:00:00.000Z",
        runningBalance: { amount: "10.00", currency: "USD" },
      },
      {
        createdAt: "2026-08-01T18:00:00.000Z",
        runningBalance: { amount: "25.00", currency: "USD" },
      },
      {
        createdAt: "2026-08-02T09:00:00.000Z",
        runningBalance: { amount: "5.00", currency: "USD" },
      },
    ]);
    expect(series).toEqual([
      { date: "2026-08-01", count: 0, minorUnits: 2500n },
      { date: "2026-08-02", count: 0, minorUnits: 500n },
    ]);
  });

  it("plots absolute magnitude for negative balances", () => {
    const series = runningBalanceSeries([
      {
        createdAt: "2026-08-01T10:00:00.000Z",
        runningBalance: { amount: "-12.50", currency: "USD" },
      },
    ]);
    expect(series?.[0]?.minorUnits).toBe(1250n);
  });
});
