/**
 * A headline number.
 *
 * The right form for a single value: a one-bar bar chart is an anti-pattern, and
 * four of these in a row say more, more compactly, than a grouped bar chart of
 * four unrelated measures would.
 *
 * `label` is sentence case with no trailing colon; the value is set in tabular
 * figures so a row of tiles keeps its digits aligned. Neither ever wears the
 * chart colour — text stays in ink tokens, and colour is reserved for marks.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  /** One short clarifying line. Use it where the number would otherwise be ambiguous. */
  hint?: string;
}) {
  return (
    <div className="rounded-none border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-2xl tabular-nums">{value}</p>
      {hint === undefined ? null : <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
