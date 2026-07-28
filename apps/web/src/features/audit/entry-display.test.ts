import { describe, expect, it } from "vitest";

import { actionLabel, formatMetadata, isExpectedRefusal, type WireAuditEntry } from "./entry-display";

function entry(overrides: Partial<WireAuditEntry> = {}): WireAuditEntry {
  return {
    id: "a-1",
    actorUserId: "u-1",
    action: "post_transaction",
    outcome: "posted",
    reason: null,
    transactionId: "t-1",
    metadata: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("actionLabel", () => {
  it("labels the actions it knows", () => {
    expect(actionLabel("post_transaction")).toBe("Posted a transaction");
  });

  it("falls back to the raw value for an action it has never seen", () => {
    // `action` is `z.string()`, not an enum. A switch with no default would
    // render a blank cell for exactly the novel entries worth reading — the
    // raw identifier is uglier and strictly more informative than nothing.
    expect(actionLabel("some_future_action")).toBe("some_future_action");
    expect(actionLabel("")).toBe("");
  });

  it("never returns undefined", () => {
    for (const action of ["", "x", "post_transaction", "__proto__", "toString", "constructor"]) {
      expect(typeof actionLabel(action)).toBe("string");
    }
  });
});

describe("formatMetadata", () => {
  it("returns null for absent metadata rather than the string 'null'", () => {
    expect(formatMetadata(null)).toBeNull();
    expect(formatMetadata(undefined)).toBeNull();
  });

  it("renders primitives", () => {
    expect(formatMetadata("a note")).toBe("a note");
    expect(formatMetadata(42)).toBe("42");
    expect(formatMetadata(true)).toBe("true");
  });

  it("renders an arbitrary nested object as readable JSON", () => {
    const rendered = formatMetadata({ reason: "insufficient_funds", legs: [{ amount: "1.00" }] });
    expect(rendered).toContain("insufficient_funds");
    expect(rendered).toContain("1.00");
  });

  it("renders an array", () => {
    expect(formatMetadata([1, 2])).toContain("1");
  });

  it("survives a value that cannot be serialized", () => {
    // A circular structure makes JSON.stringify throw. Inside a table cell
    // that would take down the entire log rather than one row.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatMetadata(circular)).not.toThrow();
    expect(formatMetadata(circular)).toContain("could not be displayed");
  });

  it("returns null rather than the string 'undefined' for an unserializable primitive", () => {
    expect(formatMetadata(() => undefined)).toBeNull();
    expect(formatMetadata(Symbol("x"))).toBeNull();
  });
});

describe("isExpectedRefusal", () => {
  it("recognises the refusal the sandbox intends to produce", () => {
    // Replaying a scenario run appends another identical rejection each time.
    // Without this, five identical refusals look like five bugs.
    expect(isExpectedRefusal(entry({ outcome: "rejected", reason: "insufficient_funds" }))).toBe(true);
  });

  it("does not soften an unexpected refusal", () => {
    expect(isExpectedRefusal(entry({ outcome: "rejected", reason: "currency_mismatch" }))).toBe(false);
    expect(isExpectedRefusal(entry({ outcome: "rejected", reason: null }))).toBe(false);
  });

  it("never treats a posted entry as a refusal", () => {
    expect(isExpectedRefusal(entry({ outcome: "posted", reason: "insufficient_funds" }))).toBe(false);
  });
});
