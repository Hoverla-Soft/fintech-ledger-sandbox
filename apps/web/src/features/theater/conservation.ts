import type { WirePosting } from "@/features/transactions/postings-table";
import { sumByDirection } from "@/features/transactions/postings-table";

/**
 * Progress of the conservation meter during money-flow theater.
 *
 * Starts unbalanced visually (legs revealed one at a time) and ends at 100%
 * when every debit and credit has been shown and they net to zero.
 */
export function conservationProgress(input: {
  postings: readonly WirePosting[];
  revealedCount: number;
}): {
  percent: number;
  balanced: boolean;
  debitTotal: string;
  creditTotal: string;
  currency: string;
} {
  const revealed = input.postings.slice(0, Math.max(0, input.revealedCount));
  const currency = input.postings[0]?.amount.currency ?? "";
  if (revealed.length === 0) {
    return { percent: 0, balanced: false, debitTotal: "0", creditTotal: "0", currency };
  }

  const totals = sumByDirection(revealed);
  const full = sumByDirection(input.postings);
  const balanced = full.debits === full.credits && revealed.length === input.postings.length;

  // Progress is "how much of the journal is on stage", not a money ratio —
  // comparing debit vs credit magnitudes mid-reveal invents a false story.
  const percent =
    input.postings.length === 0 ? 0 : Math.round((revealed.length / input.postings.length) * 100);

  return {
    percent,
    balanced,
    debitTotal: formatDigits(totals.debits, totals.scale),
    creditTotal: formatDigits(totals.credits, totals.scale),
    currency,
  };
}

function formatDigits(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const sign = negative ? "-" : "";
  if (scale === 0) {
    return `${sign}${digits}`;
  }
  return `${sign}${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
