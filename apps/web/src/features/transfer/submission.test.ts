import { SEED_SCENARIOS } from "@fintech-ledger-sandbox/api/sandbox/scenarios";
import { describe, expect, it } from "vitest";

import { describeTransfer, prepareTransfer } from "./submission";

describe("prepareTransfer — orientation", () => {
  it("debits the destination and credits the source, matching the funding scenario", () => {
    // The same ground truth 5a's kernel is pinned against, re-asserted at the
    // submission boundary. A balanced-but-inverted array is accepted by the
    // server, moves money the wrong way, and produces no error anywhere —
    // there is no `data.reason` for it — so this is checked at every layer
    // that could get it wrong rather than once.
    const funding = SEED_SCENARIOS.find((scenario) => scenario.id === "funding");
    expect(funding).toBeDefined();
    const debitLeg = funding?.legs.find((leg) => leg.direction === "debit");
    const creditLeg = funding?.legs.find((leg) => leg.direction === "credit");
    expect(debitLeg?.accountName).toBe("Operating");
    expect(creditLeg?.accountName).toBe("Sandbox Funding");

    const prepared = prepareTransfer({
      sourceAccountId: "sandbox-funding",
      destinationAccountId: "operating",
      amount: "5000.00",
      currency: "USD",
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error("expected a prepared transfer");
    }
    expect(prepared.postings).toEqual([
      { accountId: "operating", direction: "debit", amount: "5000.00", currency: "USD" },
      { accountId: "sandbox-funding", direction: "credit", amount: "5000.00", currency: "USD" },
    ]);
  });

  it("produces a different payload when source and destination are swapped", () => {
    const forward = prepareTransfer({
      sourceAccountId: "a",
      destinationAccountId: "b",
      amount: "1.00",
      currency: "USD",
    });
    const backward = prepareTransfer({
      sourceAccountId: "b",
      destinationAccountId: "a",
      amount: "1.00",
      currency: "USD",
    });
    expect(forward.ok && backward.ok).toBe(true);
    if (!forward.ok || !backward.ok) {
      throw new Error("expected both to prepare");
    }
    // Every "it balances" assertion is equally satisfied by a backwards
    // transfer, so balance alone proves nothing about direction.
    expect(forward.postings).not.toEqual(backward.postings);
  });
});

describe("prepareTransfer — scale", () => {
  it("sends 1250 minor units for a USD 12.50", () => {
    const prepared = prepareTransfer({
      sourceAccountId: "a",
      destinationAccountId: "b",
      amount: "12.50",
      currency: "USD",
    });
    if (!prepared.ok) {
      throw new Error("expected a prepared transfer");
    }
    expect(prepared.minorUnits).toBe(1250n);
    expect(prepared.postings.every((posting) => posting.amount === "12.50")).toBe(true);
  });

  it("sends 1250 for a JPY 1250, not 125000", () => {
    // A hardcoded exponent of 2 would send a hundred times too much here.
    const prepared = prepareTransfer({
      sourceAccountId: "a",
      destinationAccountId: "b",
      amount: "1250",
      currency: "JPY",
    });
    if (!prepared.ok) {
      throw new Error("expected a prepared transfer");
    }
    expect(prepared.minorUnits).toBe(1250n);
    expect(prepared.postings[0]?.amount).toBe("1250");
  });

  it("rejects JPY 12.50 as excess precision rather than rounding it", () => {
    const prepared = prepareTransfer({
      sourceAccountId: "a",
      destinationAccountId: "b",
      amount: "12.50",
      currency: "JPY",
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) {
      throw new Error("expected rejection");
    }
    expect(prepared.field).toBe("amount");
  });
});

describe("prepareTransfer — rejections carry the field that caused them", () => {
  const base = { sourceAccountId: "a", destinationAccountId: "b", currency: "USD" };

  it.each([
    ["", "amount"],
    ["   ", "amount"],
    ["abc", "amount"],
    ["1e5", "amount"],
    ["-5.00", "amount"],
    ["0", "amount"],
    ["0.00", "amount"],
  ])("rejects amount %j on the amount field", (amount, field) => {
    const prepared = prepareTransfer({ ...base, amount });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) {
      throw new Error("expected rejection");
    }
    expect(prepared.field).toBe(field);
  });

  it("asks for a source before anything else", () => {
    const prepared = prepareTransfer({ ...base, sourceAccountId: "", amount: "1.00" });
    if (prepared.ok) {
      throw new Error("expected rejection");
    }
    expect(prepared.field).toBe("source");
  });

  it("asks for a destination when only the source is chosen", () => {
    const prepared = prepareTransfer({ ...base, destinationAccountId: "", amount: "1.00" });
    if (prepared.ok) {
      throw new Error("expected rejection");
    }
    expect(prepared.field).toBe("destination");
  });

  it("rejects a transfer to the same account on the destination field", () => {
    const prepared = prepareTransfer({
      sourceAccountId: "same",
      destinationAccountId: "same",
      amount: "1.00",
      currency: "USD",
    });
    if (prepared.ok) {
      throw new Error("expected rejection");
    }
    expect(prepared.field).toBe("destination");
  });

  it("never returns a message that leaks the server's wording", () => {
    const prepared = prepareTransfer({ ...base, amount: "nonsense" });
    if (prepared.ok) {
      throw new Error("expected rejection");
    }
    expect(prepared.message.length).toBeGreaterThan(0);
    expect(prepared.message).not.toContain("undefined");
  });
});

describe("describeTransfer", () => {
  it("names direction in plain language, using account names rather than ids", () => {
    // The human half of the inverted-array defence: the machine proves the
    // legs balance, the person confirms which way the money goes.
    const sentence = describeTransfer({
      sourceName: "Operating",
      destinationName: "Employee A",
      amount: "1500.00",
      currency: "USD",
    });
    expect(sentence).toBe("Move 1500.00 USD out of Operating and into Employee A.");
  });

  it("reads differently when the direction is reversed", () => {
    const forward = describeTransfer({
      sourceName: "A",
      destinationName: "B",
      amount: "1.00",
      currency: "USD",
    });
    const backward = describeTransfer({
      sourceName: "B",
      destinationName: "A",
      amount: "1.00",
      currency: "USD",
    });
    expect(forward).not.toBe(backward);
  });
});
