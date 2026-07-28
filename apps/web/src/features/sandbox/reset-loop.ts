/**
 * Drives `sandbox.reset` to completion.
 *
 * Reset is **chunked and caller-driven**: each call zeroes up to a bounded
 * number of accounts and returns `remaining`, the count still holding a
 * non-zero balance. The caller loops until that reaches `0`
 * (`docs/adr/0008-sandbox-reset.md`). There is no server-side job to wait on.
 *
 * Pure by construction — it takes a `call` function rather than importing the
 * client — so termination, chunking, throttle handling, and the alarm path can
 * all be tested without a network or a database. That matters more here than
 * elsewhere: this loop issues repeated *writes*, and a bug that makes it loop
 * forever, stop early, or restart mid-way has real consequences for balances.
 */

export interface ResetResponse {
  readonly accountsZeroed: number;
  readonly remaining: number;
  readonly transactionIds: readonly string[];
}

export interface ResetProgress {
  readonly calls: number;
  readonly accountsZeroed: number;
  readonly remaining: number;
}

export type ResetOutcome =
  | { readonly status: "complete"; readonly progress: ResetProgress; readonly transactionIds: readonly string[] }
  /**
   * The compensating entry did not balance. `ADR 0008` has reset *refuse*
   * rather than destroy evidence, so this is a reconciliation alarm — not a
   * form error and not something to retry.
   */
  | { readonly status: "unbalanced"; readonly progress: ResetProgress; readonly error: unknown }
  | { readonly status: "failed"; readonly progress: ResetProgress; readonly error: unknown };

export interface ResetLoopOptions {
  /** Issues one chunk. Receives the run key, which is identical on every call. */
  readonly call: (idempotencyKey: string) => Promise<ResetResponse>;
  readonly idempotencyKey: string;
  /** Classifies a thrown value. Injected so the loop stays free of the error module. */
  readonly classify: (error: unknown) => { reason: string | null; retryAfterSeconds?: number };
  /** Awaits a pause. Injected so tests do not sleep. */
  readonly wait?: (seconds: number) => Promise<void>;
  /** Reports cumulative progress after each chunk. */
  readonly onProgress?: (progress: ResetProgress) => void;
  /**
   * Backstop against a server that never reduces `remaining`. Without it a
   * misbehaving endpoint would spin forever issuing writes.
   */
  readonly maxCalls?: number;
}

const DEFAULT_MAX_CALLS = 100;
const DEFAULT_THROTTLE_PAUSE_SECONDS = 5;

export async function runResetLoop(options: ResetLoopOptions): Promise<ResetOutcome> {
  const {
    call,
    idempotencyKey,
    classify,
    wait = defaultWait,
    onProgress,
    maxCalls = DEFAULT_MAX_CALLS,
  } = options;

  let calls = 0;
  let accountsZeroed = 0;
  let remaining = Number.POSITIVE_INFINITY;
  const transactionIds: string[] = [];

  while (calls < maxCalls) {
    let response: ResetResponse;

    try {
      // The **same key every time**. Reset is idempotent per key, so a retried
      // chunk replays rather than double-compensating. Minting a fresh key
      // mid-loop would re-post work already applied.
      response = await call(idempotencyKey);
    } catch (error) {
      const classified = classify(error);

      if (classified.reason === "rate_limited") {
        // Charged per chunk against 60/min/org and 30/min/user, so a large
        // ledger can throttle its own loop. Pause and resume — do not restart,
        // and do not surface this as a failure.
        await wait(classified.retryAfterSeconds ?? DEFAULT_THROTTLE_PAUSE_SECONDS);
        continue;
      }

      const progress = { calls, accountsZeroed, remaining: finite(remaining) };

      if (classified.reason === "unbalanced_transaction") {
        return { status: "unbalanced", progress, error };
      }
      return { status: "failed", progress, error };
    }

    calls += 1;
    accountsZeroed += response.accountsZeroed;
    transactionIds.push(...response.transactionIds);
    remaining = response.remaining;

    onProgress?.({ calls, accountsZeroed, remaining });

    if (remaining <= 0) {
      return {
        status: "complete",
        progress: { calls, accountsZeroed, remaining: 0 },
        transactionIds,
      };
    }
  }

  // Ran out of iterations with work still outstanding. Reported as a failure
  // rather than silently claiming success — the ledger is in a partially
  // unwound state and someone needs to know.
  return {
    status: "failed",
    progress: { calls, accountsZeroed, remaining: finite(remaining) },
    error: new Error(`Reset did not finish within ${maxCalls} calls; ${finite(remaining)} accounts still hold a balance.`),
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function defaultWait(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}
