/**
 * Forward-only cursor paging, with a client-held stack for going back.
 *
 * Every paginated procedure returns a `nextCursor` and nothing else — no
 * `prevCursor`, no total, no `hasPrevious`. So "previous" cannot be requested;
 * it can only be *remembered*. This module holds the cursors already used and
 * pops them, which is the only correct way to offer back-navigation over a
 * forward-only API.
 *
 * Lives in `lib/` rather than under `features/transactions/` since Phase 7a:
 * the transactions, accounts, audit, and reconciliation screens all page, and
 * none of this is transaction-specific.
 *
 * The cursor itself is **opaque** (`packages/api/src/contracts/cursor.ts`
 * encodes a `createdAt`/`id` pair as base64url). Nothing here inspects,
 * decodes, or constructs one — it is carried as a string and handed back
 * exactly as received. Building one client-side would couple the console to an
 * encoding the API is free to change, and a hand-built cursor that decoded to
 * an `Invalid Date` would come back as a silently empty page rather than an
 * error.
 */

export interface PageState {
  /** The cursor for the page currently displayed. `null` is page one. */
  readonly cursor: string | null;
  /** Cursors of the pages walked through to get here, oldest first. */
  readonly history: readonly (string | null)[];
}

export const FIRST_PAGE: PageState = { cursor: null, history: [] };

/** True when there is a page to go back to. */
export function hasPrevious(state: PageState): boolean {
  return state.history.length > 0;
}

/**
 * Advances to the page `nextCursor` points at.
 *
 * A `null` `nextCursor` means the current page is the last one, so this is a
 * no-op rather than a step into nothing — the caller disables the control, and
 * this makes a stray click harmless too.
 */
export function goToNext(state: PageState, nextCursor: string | null): PageState {
  if (nextCursor === null) {
    return state;
  }
  return { cursor: nextCursor, history: [...state.history, state.cursor] };
}

/** Returns to the previously visited page. A no-op on page one. */
export function goToPrevious(state: PageState): PageState {
  if (state.history.length === 0) {
    return state;
  }
  const history = state.history.slice(0, -1);
  const cursor = state.history[state.history.length - 1] ?? null;
  return { cursor, history };
}

/**
 * Discards the walk and returns to the first page.
 *
 * Used when the server rejects a cursor with `400 invalid_cursor`. The whole
 * stack goes, not just the current entry: an expired cursor means the walk it
 * belongs to is no longer valid, and popping one step would just hand back
 * another cursor from the same stale sequence.
 */
export function resetToFirstPage(): PageState {
  return FIRST_PAGE;
}

/** One-based page number, for display. Derived from the walk, not from the server. */
export function pageNumber(state: PageState): number {
  return state.history.length + 1;
}
