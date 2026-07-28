import { createHash } from "node:crypto";

import type { Currency } from "@fintech-ledger-sandbox/core";

/**
 * The reset planner: non-zero balances in, one bounded chunk of opposing legs
 * out.
 *
 * ## Why reset is a compensating entry and not a reversal of each transaction
 *
 * The intuitive design — walk the history, post a reversal per transaction —
 * cannot be made both correct and terminating, because ADR 0006 deliberately
 * permits reversing a reversal. Given `T1`, its reversal `R1`, and `R2`
 * reversing `R1`:
 *
 * - "reverse everything un-reversed that is not itself a reversal" selects
 *   nothing (`T1` is reversed; `R1` and `R2` are reversals), so reset silently
 *   leaves the ledger unbalanced;
 * - "reverse anything un-reversed" selects `R2`, posts `R3`, and then finds
 *   `R3` un-reversed on the next call and posts `R4` — oscillating forever.
 *
 * No simple predicate over the reversal graph escapes that. A compensating
 * entry sidesteps the history entirely: it reads the *balances* and posts
 * their opposites, which is correct whatever shape the history has.
 *
 * ## Why it needs no plug figure
 *
 * Every transaction nets to zero, so within one currency the signed sum of
 * every account balance is already zero. Legs of `-balance` therefore also sum
 * to zero, and the transaction is balanced by construction. Every `normal`
 * account lands on exactly zero without passing through a negative balance, so
 * invariant #6 needs no special case here.
 *
 * Invariant #8 is untouched throughout: nothing is deleted or mutated, the
 * immutability trigger is never contended, and history only grows.
 */

/**
 * Accounts zeroed per call.
 *
 * `MAX_POSTINGS` in `routers/transactions.ts` caps a transaction at 100 legs,
 * so 99 accounts leaves exactly one slot for the suspense leg a partial chunk
 * needs. Bounding the work per call is what keeps reset's cost proportional to
 * the chunk rather than to ledger size (task D5).
 */
export const RESET_CHUNK_SIZE = 99;

export interface ResetBalance {
  readonly accountId: string;
  /**
   * Typed rather than a bare `string` so the value can flow into
   * `createAccount` and `Money.ofMinorUnits` without an unchecked assertion.
   * It originates as a `Currency` on `LedgerAccountRow`; widening it here and
   * casting it back at the call site would be asserting a fact that was
   * already known.
   */
  readonly currency: Currency;
  /** Signed minor units — debit-positive, matching `core.signedAmount`. */
  readonly minorUnits: bigint;
}

export interface ResetLeg {
  readonly accountId: string;
  readonly direction: "debit" | "credit";
  /** Always positive: a posting amount must be strictly greater than zero. */
  readonly minorUnits: bigint;
}

/**
 * What the caller must post against a suspense account to balance a partial
 * chunk. Expressed as a requirement rather than a leg because this module is
 * pure and the suspense account's id does not exist until the handler resolves
 * or creates it.
 */
export interface SuspenseRequirement {
  readonly currency: Currency;
  readonly direction: "debit" | "credit";
  readonly minorUnits: bigint;
}

export interface ResetChunk {
  readonly currency: Currency;
  readonly legs: readonly ResetLeg[];
  /** `null` when the chunk is already balanced on its own — the common case. */
  readonly suspense: SuspenseRequirement | null;
  readonly accountsZeroed: number;
  /** Stable fingerprint of this chunk's work, for the idempotency key (task D6). */
  readonly chunkHash: string;
}

function isNonZero(balance: ResetBalance): boolean {
  return balance.minorUnits !== 0n;
}

function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** How many accounts still hold a non-zero balance, across every currency. */
export function countNonZero(balances: readonly ResetBalance[]): number {
  return balances.filter(isNonZero).length;
}

/**
 * Plans the next chunk, or `null` when every balance is already zero.
 *
 * One call plans **one** chunk — at most `chunkSize` accounts in total, not
 * per currency. Currencies are taken in ascending ISO order and a chunk never
 * spans two, because invariant #7 forbids a transaction whose legs disagree on
 * currency. A caller looping until `countNonZero` reaches zero therefore drains
 * every currency without needing to know how many exist.
 */
export function planResetChunk(
  balances: readonly ResetBalance[],
  chunkSize: number = RESET_CHUNK_SIZE,
): ResetChunk | null {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`reset chunk size must be a positive integer, got ${chunkSize}`);
  }

  const pending = balances.filter(isNonZero);
  if (pending.length === 0) {
    return null;
  }

  // Deterministic across calls, which is what makes a resumed reset re-derive
  // the same chunk — and therefore the same idempotency key — for the same
  // remaining work.
  const currency = pending
    .map((balance) => balance.currency)
    .sort((left, right) => left.localeCompare(right))[0] as Currency;

  const inCurrency = pending
    .filter((balance) => balance.currency === currency)
    .sort((left, right) => left.accountId.localeCompare(right.accountId));

  const taken = inCurrency.slice(0, chunkSize);
  const isFinalChunkForCurrency = taken.length === inCurrency.length;

  const legs: ResetLeg[] = taken.map((balance) => ({
    accountId: balance.accountId,
    // The opposite of the balance: a positive (net-debit) balance is cleared
    // by a credit, and vice versa.
    direction: balance.minorUnits > 0n ? "credit" : "debit",
    minorUnits: magnitude(balance.minorUnits),
  }));

  const takenSum = taken.reduce((total, balance) => total + balance.minorUnits, 0n);

  /**
   * A suspense leg is emitted **only** for a partial take, and that condition
   * is load-bearing rather than an optimization.
   *
   * On a final take the accounts' balances must already sum to zero — that is
   * the conservation property this whole design rests on. Emitting a suspense
   * leg there would absorb any discrepancy and silently paper over a broken
   * reconciliation. Omitting it means an unbalanced set reaches
   * `Transaction.create` and is refused as `422 unbalanced_transaction`, which
   * is exactly what task D7 requires: reset is the tool reached for when a
   * sandbox looks wrong, so it must not destroy the evidence.
   *
   * A partial take whose own sum happens to be zero needs no suspense leg
   * either — and must not get one, since a zero-amount posting is not a valid
   * posting.
   */
  const needsSuspense = !isFinalChunkForCurrency && takenSum !== 0n;

  return {
    currency,
    legs,
    suspense: needsSuspense
      ? {
          currency,
          // The legs above sum to `-takenSum`, so the suspense leg must
          // contribute `+takenSum` for the transaction to net to zero.
          direction: takenSum > 0n ? "debit" : "credit",
          minorUnits: magnitude(takenSum),
        }
      : null,
    accountsZeroed: taken.length,
    chunkHash: hashChunk(currency, taken),
  };
}

/**
 * Fingerprints the work a chunk represents.
 *
 * Scoped beneath the caller's run key by the handler, never used alone. On its
 * own it would collide across generations: seed → reset → seed → reset
 * produces a byte-identical second chunk, which would replay the first reset's
 * transaction and leave the balances standing. Beneath a fresh run key it does
 * the opposite job — a retried or resumed chunk re-derives the same key and
 * replays instead of double-posting.
 *
 * Built by hand rather than `JSON.stringify`'d over an object literal, for the
 * same reason `contracts/request-hash.ts` is: `JSON.stringify` preserves
 * insertion order, so reordering two properties in a literal would silently
 * change every key.
 */
function hashChunk(currency: Currency, taken: readonly ResetBalance[]): string {
  const parts = taken.map(
    (balance) =>
      `{"accountId":${JSON.stringify(balance.accountId)},"minorUnits":"${balance.minorUnits}"}`,
  );
  const canonical = `{"accounts":[${parts.join(",")}],"currency":${JSON.stringify(currency)}}`;

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
