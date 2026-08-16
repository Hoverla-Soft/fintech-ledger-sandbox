import type { Currency } from "@fintech-ledger-sandbox/core";
import { describe, expect, it } from "vitest";

import {
  countNonZero,
  planResetChunk,
  RESET_CHUNK_SIZE,
  type ResetBalance,
  type ResetChunk,
} from "./reset-plan";

/**
 * The chunking algebra, proven without a database.
 *
 * This is where reset's real risk lives — termination, balance, and the
 * conditional suspense leg that task D7 depends on — and all of it is decidable
 * from balances alone. The integration suite in `routers/sandbox.test.ts`
 * proves the wiring; this proves the arithmetic.
 */

function balance(accountId: string, minorUnits: bigint, currency: Currency = "USD"): ResetBalance {
  return { accountId, currency, minorUnits };
}

/** The signed sum a chunk's postings contribute — must be zero for `Transaction.create` to accept it. */
function signedSum(chunk: ResetChunk): bigint {
  const legs = chunk.legs.reduce(
    (total, leg) => total + (leg.direction === "debit" ? leg.minorUnits : -leg.minorUnits),
    0n,
  );
  if (chunk.suspense === null) {
    return legs;
  }
  return (
    legs +
    (chunk.suspense.direction === "debit" ? chunk.suspense.minorUnits : -chunk.suspense.minorUnits)
  );
}

/** A conserving set: `count` accounts whose balances sum to zero, as any real ledger's do. */
function conservingSet(count: number, currency: Currency = "USD"): ResetBalance[] {
  const accounts: ResetBalance[] = [];
  let running = 0n;

  for (let index = 0; index < count - 1; index += 1) {
    const amount = BigInt((index + 1) * 100);
    accounts.push(balance(`acct-${String(index).padStart(4, "0")}`, amount, currency));
    running += amount;
  }
  // The last account absorbs the rest, so the whole set nets to zero.
  accounts.push(balance(`acct-${String(count - 1).padStart(4, "0")}`, -running, currency));

  return accounts;
}

/** Drives reset to completion the way a caller does, applying each chunk to the balances. */
function runToCompletion(
  initial: readonly ResetBalance[],
  chunkSize: number = RESET_CHUNK_SIZE,
): { readonly calls: number; readonly final: readonly ResetBalance[] } {
  const current = new Map(initial.map((entry) => [entry.accountId, entry]));
  let calls = 0;

  while (calls < 1000) {
    const chunk = planResetChunk([...current.values()], chunkSize);
    if (chunk === null) {
      break;
    }
    calls += 1;

    expect(signedSum(chunk)).toBe(0n);
    expect(chunk.legs.length + (chunk.suspense === null ? 0 : 1)).toBeLessThanOrEqual(
      chunkSize + 1,
    );

    for (const leg of chunk.legs) {
      const existing = current.get(leg.accountId);
      if (existing === undefined) {
        throw new Error(`chunk referenced unknown account "${leg.accountId}"`);
      }
      const delta = leg.direction === "debit" ? leg.minorUnits : -leg.minorUnits;
      current.set(leg.accountId, { ...existing, minorUnits: existing.minorUnits + delta });
    }

    if (chunk.suspense !== null) {
      const suspenseId = `suspense-${chunk.suspense.currency}`;
      const existing = current.get(suspenseId) ?? balance(suspenseId, 0n, chunk.suspense.currency);
      const delta =
        chunk.suspense.direction === "debit"
          ? chunk.suspense.minorUnits
          : -chunk.suspense.minorUnits;
      current.set(suspenseId, { ...existing, minorUnits: existing.minorUnits + delta });
    }
  }

  return { calls, final: [...current.values()] };
}

describe("countNonZero", () => {
  it("ignores accounts already at zero", () => {
    expect(countNonZero([balance("a", 0n), balance("b", 500n), balance("c", 0n)])).toBe(1);
  });

  it("counts across every currency, not just the one reset would take next", () => {
    expect(
      countNonZero([
        balance("a", 100n, "EUR"),
        balance("b", -100n, "EUR"),
        balance("c", 50n, "USD"),
      ]),
    ).toBe(3);
  });
});

describe("planResetChunk", () => {
  it("returns null when nothing is left to do", () => {
    expect(planResetChunk([])).toBeNull();
    expect(planResetChunk([balance("a", 0n), balance("b", 0n)])).toBeNull();
  });

  it("clears a positive balance with a credit and a negative one with a debit", () => {
    const chunk = planResetChunk([balance("a", 2500n), balance("b", -2500n)]);

    expect(chunk?.legs).toEqual([
      { accountId: "a", direction: "credit", minorUnits: 2500n },
      { accountId: "b", direction: "debit", minorUnits: 2500n },
    ]);
  });

  it("needs no suspense account when every non-zero account fits in one chunk", () => {
    const chunk = planResetChunk(conservingSet(6));

    expect(chunk?.suspense).toBeNull();
    expect(chunk?.accountsZeroed).toBe(6);
    expect(signedSum(chunk as ResetChunk)).toBe(0n);
  });

  it("emits only positive leg amounts", () => {
    const chunk = planResetChunk(conservingSet(8));

    for (const leg of chunk?.legs ?? []) {
      expect(leg.minorUnits).toBeGreaterThan(0n);
    }
  });

  it("skips accounts already at zero rather than emitting a zero-amount posting", () => {
    const chunk = planResetChunk([balance("a", 700n), balance("b", 0n), balance("c", -700n)]);

    expect(chunk?.accountsZeroed).toBe(2);
    expect(chunk?.legs.map((leg) => leg.accountId)).toEqual(["a", "c"]);
  });
});

describe("planResetChunk — the chunk boundary", () => {
  it("takes every account and needs no suspense leg at exactly the chunk size", () => {
    const chunk = planResetChunk(conservingSet(RESET_CHUNK_SIZE));

    expect(chunk?.accountsZeroed).toBe(RESET_CHUNK_SIZE);
    expect(chunk?.suspense).toBeNull();
    expect(signedSum(chunk as ResetChunk)).toBe(0n);
  });

  it("splits and opens a suspense leg one account past the chunk size", () => {
    const chunk = planResetChunk(conservingSet(RESET_CHUNK_SIZE + 1));

    expect(chunk?.accountsZeroed).toBe(RESET_CHUNK_SIZE);
    expect(chunk?.suspense).not.toBeNull();
    // 99 account legs plus the suspense leg is exactly MAX_POSTINGS (100).
    expect(chunk?.legs).toHaveLength(99);
    expect(signedSum(chunk as ResetChunk)).toBe(0n);
  });

  it("omits the suspense leg when a partial chunk happens to balance itself", () => {
    // Needs five accounts, not four: the taken three must net to zero while
    // something non-zero still remains, and in a conserving set that forces the
    // remainder to be a balanced pair of its own. With four, a zero-summing
    // first three would leave a fourth at zero — filtered out, so the take
    // would not be partial at all.
    const chunk = planResetChunk(
      [
        balance("a", 300n),
        balance("b", -100n),
        balance("c", -200n),
        balance("d", 900n),
        balance("e", -900n),
      ],
      3,
    );

    expect(chunk?.accountsZeroed).toBe(3);
    expect(chunk?.legs.map((leg) => leg.accountId)).toEqual(["a", "b", "c"]);
    expect(chunk?.suspense).toBeNull();
  });
});

describe("planResetChunk — termination", () => {
  it("drives a ledger far larger than one chunk to all zeroes", () => {
    const { calls, final } = runToCompletion(conservingSet(250));

    expect(calls).toBeGreaterThan(1);
    expect(countNonZero(final)).toBe(0);
  });

  it("drives an exactly-one-over-the-boundary ledger to all zeroes", () => {
    const { final } = runToCompletion(conservingSet(RESET_CHUNK_SIZE + 1));

    expect(countNonZero(final)).toBe(0);
  });

  it("finishes in a single call when the ledger already fits", () => {
    const { calls, final } = runToCompletion(conservingSet(10));

    expect(calls).toBe(1);
    expect(countNonZero(final)).toBe(0);
  });
});

describe("planResetChunk — currencies", () => {
  it("never mixes two currencies in one chunk", () => {
    const chunk = planResetChunk([
      balance("a", 100n, "USD"),
      balance("b", -100n, "USD"),
      balance("c", 250n, "EUR"),
      balance("d", -250n, "EUR"),
    ]);

    expect(chunk?.currency).toBe("EUR");
    expect(chunk?.legs.map((leg) => leg.accountId)).toEqual(["c", "d"]);
  });

  it("drains every currency when looped to completion", () => {
    const { final } = runToCompletion([...conservingSet(4, "USD"), ...conservingSet(4, "EUR")]);

    expect(countNonZero(final)).toBe(0);
  });
});

describe("planResetChunk — a broken ledger is not papered over", () => {
  /**
   * Task D7. On a final take the planner emits no suspense leg, so balances
   * that do not sum to zero produce an unbalanced posting set that
   * `Transaction.create` refuses as `422 unbalanced_transaction`. Absorbing the
   * discrepancy into a suspense account would destroy the evidence of a
   * reconciliation break at the moment it matters most.
   */
  it("leaves a non-conserving set unbalanced instead of absorbing the difference", () => {
    const chunk = planResetChunk([balance("a", 500n), balance("b", -100n)]);

    expect(chunk?.suspense).toBeNull();
    expect(signedSum(chunk as ResetChunk)).not.toBe(0n);
  });
});

describe("planResetChunk — chunk hashes", () => {
  it("is stable for the same remaining work, so a resumed chunk replays", () => {
    const first = planResetChunk(conservingSet(120));
    const second = planResetChunk(conservingSet(120));

    expect(first?.chunkHash).toBe(second?.chunkHash);
  });

  it("differs between two chunks of one reset, so they cannot collide", () => {
    const initial = conservingSet(120);
    const first = planResetChunk(initial);

    const afterFirst = initial.map((entry) =>
      first?.legs.some((leg) => leg.accountId === entry.accountId)
        ? { ...entry, minorUnits: 0n }
        : entry,
    );
    const second = planResetChunk(afterFirst);

    expect(second).not.toBeNull();
    expect(second?.chunkHash).not.toBe(first?.chunkHash);
  });

  it("differs when an amount differs but the accounts do not", () => {
    const left = planResetChunk([balance("a", 100n), balance("b", -100n)]);
    const right = planResetChunk([balance("a", 200n), balance("b", -200n)]);

    expect(left?.chunkHash).not.toBe(right?.chunkHash);
  });
});

describe("planResetChunk — input guards", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects a chunk size of %s", (size) => {
    expect(() => planResetChunk([balance("a", 100n)], size)).toThrow(/positive integer/);
  });
});
