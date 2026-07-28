import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// `Link` reads router context, which a bare `render` has none of. Stubbed to a
// plain anchor: this file is asserting how an outcome is *classified and
// labelled*, not how navigation resolves.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

import { isExpectedRejection, type ScenarioOutcome } from "./scenario-outcomes";

function outcome(overrides: Partial<ScenarioOutcome> = {}): ScenarioOutcome {
  return {
    id: "funding",
    outcome: "posted",
    transactionId: "11111111-2222-3333-4444-555555555555",
    reason: null,
    ...overrides,
  };
}

describe("isExpectedRejection", () => {
  it("recognises the scenario that is designed to be refused", () => {
    // The seed set deliberately includes a transfer the ledger must reject —
    // it demonstrates invariant #6 and gives the rejections log real data.
    // Rendering it as a failure would report the suite as broken when it is
    // behaving exactly as designed.
    expect(
      isExpectedRejection(
        outcome({ outcome: "rejected", reason: "insufficient_funds", transactionId: null }),
      ),
    ).toBe(true);
  });

  it("does not treat an unexpected rejection as expected", () => {
    expect(
      isExpectedRejection(
        outcome({ outcome: "rejected", reason: "currency_mismatch", transactionId: null }),
      ),
    ).toBe(false);
    expect(
      isExpectedRejection(outcome({ outcome: "rejected", reason: null, transactionId: null })),
    ).toBe(false);
  });

  it("does not treat a posted scenario as a rejection", () => {
    expect(isExpectedRejection(outcome({ outcome: "posted" }))).toBe(false);
  });
});

describe("ScenarioOutcomes", () => {
  // Imported lazily so the pure assertions above run even if rendering breaks.
  it("renders an expected refusal distinctly from both a success and a failure", async () => {
    const { ScenarioOutcomes } = await import("./scenario-outcomes");
    render(
      <ScenarioOutcomes
        outcomes={[
          outcome({ id: "funding", outcome: "posted" }),
          outcome({
            id: "insufficient_funds",
            outcome: "rejected",
            reason: "insufficient_funds",
            transactionId: null,
          }),
          outcome({
            id: "broken",
            outcome: "rejected",
            reason: "currency_mismatch",
            transactionId: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("posted")).toBeInTheDocument();
    expect(screen.getByText("refused as expected")).toBeInTheDocument();
    // A genuine failure still shows its reason, unsoftened.
    expect(screen.getByText("currency_mismatch")).toBeInTheDocument();
  });

  it("says that re-running appends another rejection entry", async () => {
    const { ScenarioOutcomes } = await import("./scenario-outcomes");
    render(<ScenarioOutcomes outcomes={[outcome()]} />);
    expect(screen.getByText(/appends another rejection entry/i)).toBeInTheDocument();
  });

  it("renders a dash rather than a broken link when a scenario posted nothing", async () => {
    const { ScenarioOutcomes } = await import("./scenario-outcomes");
    render(
      <ScenarioOutcomes
        outcomes={[
          outcome({ outcome: "rejected", reason: "insufficient_funds", transactionId: null }),
        ]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
