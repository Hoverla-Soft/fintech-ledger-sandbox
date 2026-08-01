import { decomposeDecimal, formatFromDigits } from "@/lib/ledger/amount";

export interface WireReconciliation {
  readonly accountId: string;
  readonly accountName: string;
  readonly recordedBalance: { readonly amount: string; readonly currency: string };
  readonly computedBalance: { readonly amount: string; readonly currency: string };
  readonly reconciled: boolean;
}

/**
 * The gap between what an account *says* it holds and what its postings *say*
 * it holds.
 *
 * Invariant #2 is `signed Σ(postings) == account.balance`. When it fails, the
 * boolean is the alarm and this number is the diagnosis — an operator needs to
 * know which account and by how much, not merely that something is wrong.
 *
 * Computed with `BigInt` over the decimal strings, never `Number`
 * (`docs/adr/0002-money-representation.md`). Both balances come from the same
 * account and so share a currency and a scale; they are padded to a common
 * width anyway, because the one place a scale assumption would silently hold
 * is exactly the place it must not.
 */
export function driftMinorUnits(entry: WireReconciliation): bigint {
  const recorded = decomposeDecimal(entry.recordedBalance.amount);
  const computed = decomposeDecimal(entry.computedBalance.amount);
  const width = Math.max(recorded.fraction.length, computed.fraction.length);

  return toScaled(recorded, width) - toScaled(computed, width);
}

/** Renders the drift as a signed decimal at the balances' own scale. */
export function formatDrift(entry: WireReconciliation): string {
  const recorded = decomposeDecimal(entry.recordedBalance.amount);
  const computed = decomposeDecimal(entry.computedBalance.amount);
  const width = Math.max(recorded.fraction.length, computed.fraction.length);
  const drift = driftMinorUnits(entry);
  const formatted = formatFromDigits(drift < 0n ? -drift : drift, width);
  if (drift > 0n) {
    return `+${formatted}`;
  }
  if (drift < 0n) {
    return `-${formatted}`;
  }
  return formatted;
}

function toScaled(
  part: { negative: boolean; integer: string; fraction: string },
  width: number,
): bigint {
  const magnitude = BigInt(`${part.integer}${part.fraction.padEnd(width, "0")}`);
  return part.negative ? -magnitude : magnitude;
}
