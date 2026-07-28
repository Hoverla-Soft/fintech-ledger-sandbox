/**
 * The product mark: one rule with a bar leaving to each side of it.
 *
 * It is a debit and a credit around a single balancing line — the one idea the
 * whole product is built on — rather than a generic glyph standing in for a
 * logo the user has not supplied.
 */
export function LedgerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M8 1.5v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      <path d="M8 5h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      <path d="M2.5 11H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}
