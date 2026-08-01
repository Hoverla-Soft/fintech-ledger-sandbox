import { describe, expect, it } from "vitest";

import { isExpectedRejection, type ScenarioOutcome } from "./scenario-outcomes";

describe("isExpectedRejection", () => {
  it("treats insufficient_funds as the designed refusal", () => {
    const outcome: ScenarioOutcome = {
      id: "insufficient_funds",
      outcome: "rejected",
      transactionId: null,
      reason: "insufficient_funds",
    };
    expect(isExpectedRejection(outcome)).toBe(true);
  });

  it("does not celebrate an unexpected rejection reason", () => {
    const outcome: ScenarioOutcome = {
      id: "payroll",
      outcome: "rejected",
      transactionId: null,
      reason: "unbalanced_transaction",
    };
    expect(isExpectedRejection(outcome)).toBe(false);
  });
});
