import { describe, expect, it } from "vitest";

import { driftMinorUnits, formatDrift, type WireReconciliation } from "./drift";

function entry(recorded: string, computed: string, currency = "USD"): WireReconciliation {
  return {
    accountId: "acc-1",
    accountName: "Operating",
    recordedBalance: { amount: recorded, currency },
    computedBalance: { amount: computed, currency },
    reconciled: recorded === computed,
  };
}

describe("driftMinorUnits", () => {
  it("is zero when an account reconciles", () => {
    expect(driftMinorUnits(entry("1250.00", "1250.00"))).toBe(0n);
  });

  it("is positive when the recorded balance overstates the postings", () => {
    // Recorded says more money exists than the history accounts for.
    expect(driftMinorUnits(entry("1250.00", "1200.00"))).toBe(5000n);
  });

  it("is negative when the recorded balance understates the postings", () => {
    expect(driftMinorUnits(entry("1200.00", "1250.00"))).toBe(-5000n);
  });

  it("handles negative balances, which external accounts legitimately hold", () => {
    expect(driftMinorUnits(entry("-5000.00", "-5000.00"))).toBe(0n);
    expect(driftMinorUnits(entry("-5000.00", "-4999.99"))).toBe(-1n);
  });

  it("works at a zero-exponent scale without inventing decimals", () => {
    expect(driftMinorUnits(entry("1250", "1249", "JPY"))).toBe(1n);
  });

  it("works at a three-exponent scale", () => {
    expect(driftMinorUnits(entry("1.250", "1.249", "BHD"))).toBe(1n);
  });

  it("pads to a common width rather than comparing raw digits", () => {
    // "1.0" and "10" both reduce to the digits `10`. Comparing unscaled would
    // report these as agreeing when they differ by nine units — the same
    // false-pass trap fixed in the 5a kernel and again in the postings table.
    expect(driftMinorUnits(entry("1.0", "10"))).not.toBe(0n);
    // And genuinely-equal values written at different widths must agree.
    expect(driftMinorUnits(entry("1.0", "1.00"))).toBe(0n);
  });
});

describe("formatDrift", () => {
  it("signs the difference so the direction is readable", () => {
    expect(formatDrift(entry("1250.00", "1200.00"))).toBe("+50.00");
    expect(formatDrift(entry("1200.00", "1250.00"))).toBe("-50.00");
  });

  it("renders no sign for zero", () => {
    expect(formatDrift(entry("1250.00", "1250.00"))).toBe("0.00");
  });

  it("renders at the balances' own scale", () => {
    expect(formatDrift(entry("1250", "1249", "JPY"))).toBe("+1");
    expect(formatDrift(entry("1.250", "1.249", "BHD"))).toBe("+0.001");
  });

  it("pads a sub-unit drift rather than dropping the leading zero", () => {
    expect(formatDrift(entry("10.05", "10.00"))).toBe("+0.05");
  });
});
