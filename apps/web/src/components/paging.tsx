import { Button } from "@fintech-ledger-sandbox/ui/components/button";
import { useCallback, useEffect, useState } from "react";

import { describeFailure } from "@/lib/ledger/errors";
import {
  FIRST_PAGE,
  goToNext,
  goToPrevious,
  hasPrevious,
  type PageState,
  pageNumber,
  resetToFirstPage,
} from "@/lib/pagination";

/**
 * The paging UI and the expired-cursor recovery, shared by every paged screen.
 *
 * Extracted in Phase 7a, when the transactions screen stopped being the only
 * one that pages. The recovery rule in `usePageState` is the reason this is one
 * implementation rather than four copies: an expired cursor must drop the
 * *whole* walk and show a notice, and a screen that got that subtly wrong — by
 * popping one step, or by rendering the error as an empty list — would tell
 * someone their ledger is empty when it is not.
 */

export interface PagingState {
  readonly page: PageState;
  /** Spread into a list procedure's input. Omits `cursor` entirely on page one. */
  readonly cursorInput: { cursor?: string };
  readonly cursorExpired: boolean;
  readonly goNext: (nextCursor: string | null) => void;
  readonly goBack: () => void;
  /** Abandons the walk and returns to page one, flagged so the screen can say why. */
  readonly expire: () => void;
}

/**
 * Holds the cursor walk for one screen.
 *
 * Takes no arguments so it can be called *before* the query that consumes
 * `cursorInput`. Recovery from a rejected cursor is a second hook
 * (`useCursorRecovery`) called after that query — the two cannot be one hook
 * without a circular dependency between the cursor and the error it produces.
 */
export function usePageState(): PagingState {
  const [page, setPage] = useState<PageState>(FIRST_PAGE);
  const [cursorExpired, setCursorExpired] = useState(false);

  const goNext = useCallback((nextCursor: string | null) => {
    setCursorExpired(false);
    setPage((current) => goToNext(current, nextCursor));
  }, []);

  const goBack = useCallback(() => {
    setCursorExpired(false);
    setPage((current) => goToPrevious(current));
  }, []);

  const expire = useCallback(() => {
    // The whole stack goes, not just the current entry: a stale cursor means
    // the sequence it belongs to is stale too, so popping one step would just
    // hand back another cursor from the same dead walk.
    setPage(resetToFirstPage());
    setCursorExpired(true);
  }, []);

  return {
    page,
    cursorInput: page.cursor === null ? {} : { cursor: page.cursor },
    cursorExpired,
    goNext,
    goBack,
    expire,
  };
}

/**
 * Sends a screen back to page one **with a notice** when the server rejects its
 * cursor.
 *
 * Rendering that failure as an empty list would tell someone their ledger is
 * empty when it is not — the single worst thing any of these screens could say.
 * Every paginated procedure reports the same `invalid_cursor` reason, so this
 * needs nothing endpoint-specific.
 */
export function useCursorRecovery(
  paging: PagingState,
  query: { readonly isError: boolean; readonly error: unknown },
): void {
  const { expire } = paging;
  const { isError, error } = query;

  useEffect(() => {
    if (!isError) {
      return;
    }
    if (describeFailure(error).reason === "invalid_cursor") {
      expire();
    }
  }, [isError, error, expire]);
}

/** Shown in place of a silently empty list when the server rejects a cursor. */
export function CursorExpiredNotice({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }
  return (
    <p role="status" className="rounded-none border p-3 text-sm">
      That page link expired, so this is the first page again.
    </p>
  );
}

/**
 * Page number plus Previous/Next.
 *
 * Both controls are disabled while a fetch is in flight, so a double-click
 * cannot push two cursors onto the walk and skip a page.
 */
export function PageControls({
  paging,
  nextCursor,
  isFetching,
}: {
  paging: PagingState;
  nextCursor: string | null;
  isFetching: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Page {pageNumber(paging.page)}</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevious(paging.page) || isFetching}
          onClick={paging.goBack}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={nextCursor === null || isFetching}
          onClick={() => paging.goNext(nextCursor)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
