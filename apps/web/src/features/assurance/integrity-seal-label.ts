/**
 * Pure labelling for the integrity seal — kept separate from the React
 * component so the copy stays pinned without mounting QueryClient.
 */
export function integritySealLabel(input: {
  allReconciled: boolean;
  accountCount: number;
  unreconciledCount: number;
  compact?: boolean;
}): string {
  const { allReconciled, accountCount, unreconciledCount, compact = false } = input;
  if (allReconciled) {
    return compact
      ? "Verified"
      : `Verified · ${accountCount} ${accountCount === 1 ? "account" : "accounts"}`;
  }
  return compact ? "Drift" : `Drift · ${unreconciledCount} of ${accountCount}`;
}
