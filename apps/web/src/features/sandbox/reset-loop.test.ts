import { describe, expect, it, vi } from "vitest";

import { type ResetResponse, runResetLoop } from "./reset-loop";

/** Classifier stub — the real one is `describeFailure`, injected in the component. */
const classify = (error: unknown) => {
  const record = (error ?? {}) as { data?: { reason?: string; retryAfterSeconds?: number } };
  return {
    reason: record.data?.reason ?? null,
    retryAfterSeconds: record.data?.retryAfterSeconds,
  };
};

function responder(pages: ResetResponse[]) {
  let index = 0;
  return vi.fn(async (_idempotencyKey: string) => {
    const page = pages[index];
    index += 1;
    if (page === undefined) {
      throw new Error("called more times than the protocol requires");
    }
    return page;
  });
}

describe("termination", () => {
  it("issues exactly three calls for a 99/150 → 99/51 → 51/0 sequence, and no fourth", () => {
    // The chunking protocol from ADR 0008. A fourth call would re-post
    // compensating entries against an already-zeroed ledger.
    const call = responder([
      { accountsZeroed: 99, remaining: 150, transactionIds: ["t1"] },
      { accountsZeroed: 99, remaining: 51, transactionIds: ["t2"] },
      { accountsZeroed: 51, remaining: 0, transactionIds: ["t3"] },
    ]);

    return runResetLoop({ call, idempotencyKey: "run-1", classify }).then((outcome) => {
      expect(call).toHaveBeenCalledTimes(3);
      expect(outcome.status).toBe("complete");
      expect(outcome.progress).toEqual({ calls: 3, accountsZeroed: 249, remaining: 0 });
    });
  });

  it("terminates immediately on an already-clean org", async () => {
    const call = responder([{ accountsZeroed: 0, remaining: 0, transactionIds: [] }]);
    const outcome = await runResetLoop({ call, idempotencyKey: "run-1", classify });

    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("complete");
    expect(outcome.progress.accountsZeroed).toBe(0);
  });

  it("uses the same run key on every call", async () => {
    const call = responder([
      { accountsZeroed: 1, remaining: 1, transactionIds: [] },
      { accountsZeroed: 1, remaining: 0, transactionIds: [] },
    ]);
    await runResetLoop({ call, idempotencyKey: "run-key", classify });

    // Reset is idempotent per key: a retried chunk replays rather than
    // double-compensating. A fresh key mid-loop re-posts applied work.
    expect(call.mock.calls.every(([key]) => key === "run-key")).toBe(true);
  });

  it("accumulates transaction ids across chunks", async () => {
    const call = responder([
      { accountsZeroed: 1, remaining: 1, transactionIds: ["a"] },
      { accountsZeroed: 1, remaining: 0, transactionIds: ["b", "c"] },
    ]);
    const outcome = await runResetLoop({ call, idempotencyKey: "k", classify });

    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") {
      throw new Error("expected completion");
    }
    expect(outcome.transactionIds).toEqual(["a", "b", "c"]);
  });

  it("reports cumulative progress per chunk, not just the last response", async () => {
    const call = responder([
      { accountsZeroed: 10, remaining: 5, transactionIds: [] },
      { accountsZeroed: 5, remaining: 0, transactionIds: [] },
    ]);
    const seen: number[] = [];
    await runResetLoop({
      call,
      idempotencyKey: "k",
      classify,
      onProgress: (progress) => seen.push(progress.accountsZeroed),
    });

    expect(seen).toEqual([10, 15]);
  });

  it("stops and reports failure rather than spinning when remaining never falls", async () => {
    // A backstop against a misbehaving endpoint. Without it the loop would
    // issue writes forever.
    const call = vi.fn(async () => ({ accountsZeroed: 0, remaining: 7, transactionIds: [] }));
    const outcome = await runResetLoop({ call, idempotencyKey: "k", classify, maxCalls: 4 });

    expect(call).toHaveBeenCalledTimes(4);
    expect(outcome.status).toBe("failed");
    expect(outcome.progress.remaining).toBe(7);
  });
});

describe("throttling", () => {
  it("pauses for retryAfterSeconds and resumes under the same key rather than restarting", async () => {
    // Chunks are charged against 60/min/org and 30/min/user, so a large ledger
    // can throttle its own loop (ADR 0007).
    let attempt = 0;
    const call = vi.fn(async (_idempotencyKey: string) => {
      attempt += 1;
      if (attempt === 2) {
        throw { data: { reason: "rate_limited", retryAfterSeconds: 12 } };
      }
      return attempt === 1
        ? { accountsZeroed: 5, remaining: 5, transactionIds: [] }
        : { accountsZeroed: 5, remaining: 0, transactionIds: [] };
    });

    const waited: number[] = [];
    const outcome = await runResetLoop({
      call,
      idempotencyKey: "run-key",
      classify,
      wait: async (seconds) => {
        waited.push(seconds);
      },
    });

    expect(waited).toEqual([12]);
    expect(outcome.status).toBe("complete");
    // Resumed, not restarted: the throttled attempt is retried, and progress
    // from before the throttle is retained.
    expect(outcome.progress.accountsZeroed).toBe(10);
    expect(call.mock.calls.every(([key]) => key === "run-key")).toBe(true);
  });

  it("falls back to a default pause when the body carries no retryAfterSeconds", async () => {
    let attempt = 0;
    const call = vi.fn(async (_idempotencyKey: string) => {
      attempt += 1;
      if (attempt === 1) {
        throw { data: { reason: "rate_limited" } };
      }
      return { accountsZeroed: 1, remaining: 0, transactionIds: [] };
    });

    const waited: number[] = [];
    await runResetLoop({
      call,
      idempotencyKey: "k",
      classify,
      wait: async (seconds) => {
        waited.push(seconds);
      },
    });

    expect(waited).toHaveLength(1);
    expect(waited[0]).toBeGreaterThan(0);
  });
});

describe("the alarm path", () => {
  it("halts on 422 unbalanced_transaction and reports it distinctly from an ordinary failure", async () => {
    // ADR 0008: reset refuses rather than destroying evidence. This is a
    // reconciliation alarm, not a form error and not something to retry.
    const call = vi.fn(async () => {
      throw { data: { reason: "unbalanced_transaction" } };
    });
    const outcome = await runResetLoop({ call, idempotencyKey: "k", classify });

    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("unbalanced");
  });

  it("halts mid-loop on the alarm and retains the progress made before it", async () => {
    let attempt = 0;
    const call = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return { accountsZeroed: 20, remaining: 10, transactionIds: [] };
      }
      throw { data: { reason: "unbalanced_transaction" } };
    });

    const outcome = await runResetLoop({ call, idempotencyKey: "k", classify });
    expect(outcome.status).toBe("unbalanced");
    expect(outcome.progress).toEqual({ calls: 1, accountsZeroed: 20, remaining: 10 });
  });

  it("reports any other failure as failed, without retrying it", async () => {
    const call = vi.fn(async () => {
      throw { data: { reason: "insufficient_role" } };
    });
    const outcome = await runResetLoop({ call, idempotencyKey: "k", classify });

    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("failed");
  });

  it("reports a transport failure with no reason as failed rather than looping", async () => {
    const call = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await runResetLoop({ call, idempotencyKey: "k", classify });

    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("failed");
  });
});
