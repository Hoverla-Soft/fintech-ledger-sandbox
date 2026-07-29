/**
 * The pieces every cursor-paginated repository read shares.
 *
 * Deliberately **not** a generic "paginate any table" helper. The cursor
 * predicate itself stays written out inline in each repository: the ascending
 * and descending forms differ, the sort key differs (`created_at` here, `name`
 * there), and a generic `AnyColumn`-typed comparison loses the column's value
 * type — which is how you get a `Date` compared against a `text` column and a
 * runtime cast instead of a compile error. Six lines of obvious, fully typed
 * SQL per repository beats one clever helper that fights the ORM.
 *
 * What *is* shared is the part that is easy to get subtly wrong in four
 * places: the fetch-one-extra bookkeeping (`splitPage`) and the page-size
 * clamp.
 */

/** Server-controlled ceiling. A caller cannot request an unbounded page regardless of what it asks for. */
export const MAX_PAGE_SIZE = 200;

/** Cursor position for a read ordered by `(created_at, id)`. */
export interface TimeCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** Cursor position for a read ordered by `(name, id)`. */
export interface NameCursor {
  readonly name: string;
  readonly id: string;
}

export interface PageRequest<TCursor> {
  readonly limit?: number;
  readonly after?: TCursor;
}

export interface Page<TItem, TCursor> {
  readonly items: readonly TItem[];
  /** `null` on the last page. Forward-only — there is no `prevCursor` to hand out. */
  readonly nextCursor: TCursor | null;
}

export function clampPageSize(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

/**
 * Splits a deliberately over-fetched result set (`limit + 1` rows) into the
 * page to return and whether another page exists.
 *
 * Over-fetching by one is what makes "is there a next page?" free. The
 * alternative — a second `count(*)` query — is both an extra round trip and a
 * different answer, since the count can change between the two queries and
 * produce a `nextCursor` pointing at nothing.
 *
 * `lastRow` is returned rather than left for the caller to re-derive: every
 * caller needs it to build the cursor, and `pageRows[pageRows.length - 1]` is
 * `undefined` under `noUncheckedIndexedAccess`, so doing it once here keeps
 * four repositories from each writing their own narrowing.
 */
export function splitPage<TRow>(
  rows: readonly TRow[],
  limit: number,
): {
  readonly pageRows: readonly TRow[];
  readonly hasMore: boolean;
  /** The row a `nextCursor` should point at, or `undefined` on an empty page. */
  readonly lastRow: TRow | undefined;
} {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return { pageRows, hasMore, lastRow: pageRows[pageRows.length - 1] };
}
