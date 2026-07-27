import { describe, expect, it } from "vitest";
import { Money } from "../money/money";
import type { Result } from "../result";
import { createPosting } from "./posting";
import type { Posting } from "./posting";
import { reverse, Transaction } from "./transaction";

function unwrapOk<T, E>(result: Result<T, E>, label: string): T {
  if (!result.ok) {
    throw new Error(`expected ok for ${label}`);
  }
  return result.value;
}

function unwrapErr<T, E>(result: Result<T, E>, label: string): E {
  if (result.ok) {
    throw new Error(`expected error for ${label}`);
  }
  return result.error;
}

function usd(minorUnits: bigint): Money {
  return unwrapOk(Money.ofMinorUnits(minorUnits, "USD"), `${minorUnits} USD`);
}

function eur(minorUnits: bigint): Money {
  return unwrapOk(Money.ofMinorUnits(minorUnits, "EUR"), `${minorUnits} EUR`);
}

function debit(accountId: string, minorUnits: bigint): Posting {
  return unwrapOk(createPosting(accountId, "debit", usd(minorUnits)), `debit ${accountId} ${minorUnits}`);
}

function credit(accountId: string, minorUnits: bigint): Posting {
  return unwrapOk(createPosting(accountId, "credit", usd(minorUnits)), `credit ${accountId} ${minorUnits}`);
}

describe("Transaction.create — leg count", () => {
  it("rejects zero postings with TooFewPostings", () => {
    const error = unwrapErr(Transaction.create([]), "zero postings");
    expect(error).toEqual({ kind: "TooFewPostings", count: 0 });
  });

  it("rejects a single posting with TooFewPostings", () => {
    const error = unwrapErr(Transaction.create([debit("a", 100n)]), "single posting");
    expect(error).toEqual({ kind: "TooFewPostings", count: 1 });
  });
});

describe("Transaction.create — currency agreement", () => {
  it("rejects postings that mix currencies", () => {
    const mismatched = unwrapOk(createPosting("b", "credit", eur(100n)), "credit EUR");
    const error = unwrapErr(Transaction.create([debit("a", 100n), mismatched]), "mixed currency");
    expect(error).toEqual({ kind: "CurrencyMismatch", expected: "USD", actual: "EUR" });
  });
});

describe("Transaction.create — balance", () => {
  it("rejects an unbalanced set and reports the correct net", () => {
    const error = unwrapErr(Transaction.create([debit("a", 100n), credit("b", 60n)]), "unbalanced");
    if (error.kind !== "UnbalancedTransaction") {
      throw new Error("expected UnbalancedTransaction");
    }
    expect(error.net.minorUnits).toBe(40n);
    expect(error.net.currency).toBe("USD");
  });
});

describe("Transaction.create — happy paths", () => {
  it("accepts a balanced 2-leg transfer", () => {
    const txn = unwrapOk(Transaction.create([debit("a", 100n), credit("b", 100n)]), "2-leg transfer");
    expect(txn.postings.length).toBe(2);
    expect(txn.currency).toBe("USD");
  });

  it("accepts an N-leg transaction — one debit, a fee/split across two credits", () => {
    const txn = unwrapOk(
      Transaction.create([debit("a", 100n), credit("b", 60n), credit("c", 40n)]),
      "3-leg split",
    );
    expect(txn.postings.length).toBe(3);
  });
});

describe("Transaction.create — validation order (leg count -> currency -> positivity -> balance)", () => {
  it("reports CurrencyMismatch before NonPositiveAmount when a posting violates both", () => {
    const currencyAndSignViolator: Posting = { accountId: "b", direction: "credit", amount: eur(-10n) };
    const error = unwrapErr(
      Transaction.create([debit("a", 100n), currencyAndSignViolator]),
      "currency + sign violation",
    );
    expect(error.kind).toBe("CurrencyMismatch");
  });

  it("reports NonPositiveAmount before UnbalancedTransaction when a posting violates both", () => {
    const nonPositiveViolator: Posting = { accountId: "a", direction: "debit", amount: usd(0n) };
    const error = unwrapErr(
      Transaction.create([nonPositiveViolator, credit("b", 100n)]),
      "non-positive + unbalanced",
    );
    expect(error.kind).toBe("NonPositiveAmount");
  });
});

describe("Transaction.deltas", () => {
  it("aggregates multiple postings against the same account into one net entry", () => {
    const txn = unwrapOk(
      Transaction.create([debit("a", 50n), debit("a", 50n), credit("b", 100n)]),
      "duplicate-account postings",
    );
    const deltas = txn.deltas();
    expect(deltas.size).toBe(2);

    const accountADelta = deltas.get("a");
    if (accountADelta === undefined) {
      throw new Error("expected a delta for account a");
    }
    expect(accountADelta.minorUnits).toBe(100n);

    const accountBDelta = deltas.get("b");
    if (accountBDelta === undefined) {
      throw new Error("expected a delta for account b");
    }
    expect(accountBDelta.minorUnits).toBe(-100n);
  });
});

describe("reverse", () => {
  it("produces a balanced transaction with the same currency and leg count", () => {
    const original = unwrapOk(
      Transaction.create([debit("a", 100n), credit("b", 60n), credit("c", 40n)]),
      "original 3-leg",
    );
    const reversed = reverse(original);

    expect(reversed.postings.length).toBe(original.postings.length);
    expect(reversed.currency).toBe(original.currency);

    let net = 0n;
    for (const posting of reversed.postings) {
      net += posting.direction === "debit" ? posting.amount.minorUnits : -posting.amount.minorUnits;
    }
    expect(net).toBe(0n);
  });

  it("negates every account's net delta exactly", () => {
    const original = unwrapOk(
      Transaction.create([debit("a", 50n), debit("a", 50n), credit("b", 100n)]),
      "original with an aggregated leg",
    );
    const reversed = reverse(original);
    const originalDeltas = original.deltas();
    const reversedDeltas = reversed.deltas();

    expect(reversedDeltas.size).toBe(originalDeltas.size);

    for (const [accountId, delta] of originalDeltas) {
      const reversedDelta = reversedDeltas.get(accountId);
      if (reversedDelta === undefined) {
        throw new Error(`expected a reversed delta for ${accountId}`);
      }
      expect(reversedDelta.minorUnits).toBe(-delta.minorUnits);
      expect(reversedDelta.currency).toBe(delta.currency);
    }
  });

  it("restores the original deltas when applied twice", () => {
    const original = unwrapOk(
      Transaction.create([debit("a", 100n), credit("b", 60n), credit("c", 40n)]),
      "original 3-leg",
    );
    const doubleReversed = reverse(reverse(original));
    const originalDeltas = original.deltas();
    const doubleReversedDeltas = doubleReversed.deltas();

    expect(doubleReversedDeltas.size).toBe(originalDeltas.size);

    for (const [accountId, delta] of originalDeltas) {
      const restoredDelta = doubleReversedDeltas.get(accountId);
      if (restoredDelta === undefined) {
        throw new Error(`expected a restored delta for ${accountId}`);
      }
      expect(restoredDelta.minorUnits).toBe(delta.minorUnits);
      expect(restoredDelta.currency).toBe(delta.currency);
    }
  });
});
