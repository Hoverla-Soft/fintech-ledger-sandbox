import { describe, expect, it } from "vitest";

import {
  activeCurrencies,
  barHeightPercent,
  dailyTransactionCounts,
  dailyVolume,
  isConserved,
  maxCount,
  maxMinorUnits,
  type WireActivityPoint,
  windowDays,
} from "./summary";

/** Fixed so nothing here depends on when the suite runs. */
const TODAY = new Date("2026-07-29T13:45:00.000Z");

function point(partial: Partial<WireActivityPoint> & { date: string }): WireActivityPoint {
  return {
    currency: "USD",
    transactionCount: 1,
    debitVolume: { amount: "10.00", currency: "USD" },
    ...partial,
  };
}

describe("windowDays", () => {
  it("returns the window oldest-first, ending on today", () => {
    expect(windowDays(TODAY, 4)).toEqual(["2026-07-26", "2026-07-27", "2026-07-28", "2026-07-29"]);
  });

  it("crosses a month boundary correctly", () => {
    expect(windowDays(new Date("2026-08-02T00:30:00.000Z"), 4)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("builds days in UTC, not local time", () => {
    // Late-UTC and early-UTC instants on the same UTC date must produce the same
    // window. If this used local getters, a user east or west of UTC would see
    // every bar shifted by a day against a server that groups by UTC — activity
    // on the wrong day, not merely a differently-labelled axis.
    const lateUtc = new Date("2026-07-29T23:59:59.000Z");
    const earlyUtc = new Date("2026-07-29T00:00:01.000Z");

    expect(windowDays(lateUtc, 3)).toEqual(windowDays(earlyUtc, 3));
    expect(windowDays(lateUtc, 1)).toEqual(["2026-07-29"]);
  });

  it("returns an empty window for a non-positive length rather than throwing", () => {
    expect(windowDays(TODAY, 0)).toEqual([]);
    expect(windowDays(TODAY, -5)).toEqual([]);
  });
});

describe("dailyTransactionCounts", () => {
  it("fills days with no activity with zero rather than omitting them", () => {
    // The reason gap-filling exists. Plotting only the days the server returned
    // would sit a one-day gap next to a three-day gap and read as continuous —
    // the x-axis is a timeline, so silence has to occupy its slot.
    const counts = dailyTransactionCounts(
      [point({ date: "2026-07-26", transactionCount: 2 }), point({ date: "2026-07-29" })],
      TODAY,
      4,
    );

    expect(counts.map((day) => [day.date, day.count])).toEqual([
      ["2026-07-26", 2],
      ["2026-07-27", 0],
      ["2026-07-28", 0],
      ["2026-07-29", 1],
    ]);
  });

  it("sums counts across currencies for the same day", () => {
    // Counts are dimensionless — three USD transfers and two EUR transfers
    // really are five transactions.
    const counts = dailyTransactionCounts(
      [
        point({ date: "2026-07-29", currency: "USD", transactionCount: 3 }),
        point({ date: "2026-07-29", currency: "EUR", transactionCount: 2 }),
      ],
      TODAY,
      1,
    );

    expect(counts[0]?.count).toBe(5);
  });

  it("never carries an amount on the count series", () => {
    // Amounts are not summable across currencies. If this series ever grew a
    // non-zero `minorUnits`, something would be adding USD to EUR.
    const counts = dailyTransactionCounts(
      [
        point({ date: "2026-07-29", currency: "USD" }),
        point({
          date: "2026-07-29",
          currency: "JPY",
          debitVolume: { amount: "500", currency: "JPY" },
        }),
      ],
      TODAY,
      1,
    );

    expect(counts[0]?.minorUnits).toBe(0n);
  });

  it("ignores activity outside the window", () => {
    const counts = dailyTransactionCounts(
      [point({ date: "2026-01-01", transactionCount: 99 }), point({ date: "2026-07-29" })],
      TODAY,
      2,
    );

    expect(counts).toHaveLength(2);
    expect(counts.reduce((total, day) => total + day.count, 0)).toBe(1);
  });
});

describe("dailyVolume", () => {
  it("keeps only the requested currency and sums it as minor units", () => {
    const series = dailyVolume(
      [
        point({
          date: "2026-07-29",
          currency: "USD",
          debitVolume: { amount: "0.10", currency: "USD" },
        }),
        point({
          date: "2026-07-29",
          currency: "USD",
          debitVolume: { amount: "0.20", currency: "USD" },
        }),
        point({
          date: "2026-07-29",
          currency: "EUR",
          debitVolume: { amount: "99.00", currency: "EUR" },
        }),
      ],
      "USD",
      TODAY,
      1,
    );

    // 30n, exactly. In binary floating point 0.10 + 0.20 is not 0.30 (ADR 0002).
    expect(series?.[0]?.minorUnits).toBe(30n);
  });

  it("zero-fills days with no movement in that currency", () => {
    const series = dailyVolume(
      [point({ date: "2026-07-29", debitVolume: { amount: "5.00", currency: "USD" } })],
      "USD",
      TODAY,
      3,
    );

    expect(series?.map((day) => day.minorUnits)).toEqual([0n, 0n, 500n]);
  });

  it("handles a zero-exponent currency without inventing a scale", () => {
    const series = dailyVolume(
      [
        point({
          date: "2026-07-29",
          currency: "JPY",
          debitVolume: { amount: "500", currency: "JPY" },
        }),
      ],
      "JPY",
      TODAY,
      1,
    );

    expect(series?.[0]?.minorUnits).toBe(500n);
  });

  it("returns null rather than a partial series when an amount will not parse", () => {
    // A chart drawn from the days that happened to parse would understate what
    // moved while looking authoritative. Same reasoning as the transaction-total
    // dash: "we cannot say" is a different claim from "nothing".
    const series = dailyVolume(
      [
        point({ date: "2026-07-28", debitVolume: { amount: "5.00", currency: "USD" } }),
        point({ date: "2026-07-29", debitVolume: { amount: "not-a-number", currency: "USD" } }),
      ],
      "USD",
      TODAY,
      2,
    );

    expect(series).toBeNull();
  });

  it("returns null for an unknown currency code rather than guessing an exponent", () => {
    const series = dailyVolume(
      [
        point({
          date: "2026-07-29",
          currency: "XXX",
          debitVolume: { amount: "5.00", currency: "XXX" },
        }),
      ],
      "XXX",
      TODAY,
      1,
    );

    expect(series).toBeNull();
  });
});

describe("barHeightPercent", () => {
  it("scales a value against the maximum", () => {
    expect(barHeightPercent(50n, 100n)).toBe(50);
    expect(barHeightPercent(100n, 100n)).toBe(100);
    expect(barHeightPercent(1n, 3n)).toBeCloseTo(33.3, 1);
  });

  it("returns 0 for an empty or degenerate scale instead of throwing or inventing one", () => {
    expect(barHeightPercent(5n, 0n)).toBe(0);
    expect(barHeightPercent(0n, 100n)).toBe(0);
    expect(barHeightPercent(5n, -10n)).toBe(0);
  });

  it("treats a negative value as nothing to draw", () => {
    // Debit volume cannot be negative, but a bar extending below a baseline it
    // is anchored to would be a rendering artefact rather than information.
    expect(barHeightPercent(-40n, 100n)).toBe(0);
  });

  it("never exceeds 100, so a bar cannot overflow its plot", () => {
    expect(barHeightPercent(500n, 100n)).toBe(100);
  });

  it("stays exact on amounts far beyond float precision", () => {
    // The whole point of doing the division in `bigint`. These two differ by 1
    // minor unit at a magnitude where `Number` has long since stopped being able
    // to represent consecutive integers.
    const max = 9_007_199_254_740_993n;
    expect(barHeightPercent(max, max)).toBe(100);
    expect(barHeightPercent(max - 1n, max)).toBeLessThanOrEqual(100);
  });
});

describe("maxima", () => {
  it("finds the largest amount and the largest count", () => {
    const points = [
      { date: "a", count: 3, minorUnits: 100n },
      { date: "b", count: 9, minorUnits: 25n },
    ];

    expect(maxMinorUnits(points)).toBe(100n);
    expect(maxCount(points)).toBe(9);
  });

  it("returns zero for an empty series rather than -Infinity or NaN", () => {
    expect(maxMinorUnits([])).toBe(0n);
    expect(maxCount([])).toBe(0);
  });
});

describe("activeCurrencies", () => {
  it("de-duplicates, preserving first-seen order", () => {
    // Order matters: the panels are assigned by it, and a set that reordered
    // between renders would shuffle the charts under the reader.
    expect(
      activeCurrencies([
        point({ date: "a", currency: "USD" }),
        point({ date: "b", currency: "EUR" }),
        point({ date: "c", currency: "USD" }),
      ]),
    ).toEqual(["USD", "EUR"]);
  });
});

describe("isConserved", () => {
  it("is true when the two sides mirror exactly", () => {
    expect(
      isConserved({
        currency: "USD",
        accountCount: 2,
        normalTotal: { amount: "129.75", currency: "USD" },
        externalTotal: { amount: "-129.75", currency: "USD" },
      }),
    ).toBe(true);
  });

  it("is false when they do not", () => {
    expect(
      isConserved({
        currency: "USD",
        accountCount: 2,
        normalTotal: { amount: "129.75", currency: "USD" },
        externalTotal: { amount: "-129.74", currency: "USD" },
      }),
    ).toBe(false);
  });

  it("is true at zero on both sides", () => {
    expect(
      isConserved({
        currency: "USD",
        accountCount: 1,
        normalTotal: { amount: "0.00", currency: "USD" },
        externalTotal: { amount: "0.00", currency: "USD" },
      }),
    ).toBe(true);
  });

  it("is null — not false — when a total cannot be read", () => {
    // Three states. Claiming "not conserved" on a figure we failed to parse
    // would raise a false alarm about the ledger's integrity; claiming
    // "conserved" would suppress a real one.
    expect(
      isConserved({
        currency: "USD",
        accountCount: 1,
        normalTotal: { amount: "??", currency: "USD" },
        externalTotal: { amount: "0.00", currency: "USD" },
      }),
    ).toBeNull();
  });
});
