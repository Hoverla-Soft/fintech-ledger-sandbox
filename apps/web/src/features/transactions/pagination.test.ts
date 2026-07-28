import { describe, expect, it } from "vitest";

import {
  FIRST_PAGE,
  goToNext,
  goToPrevious,
  hasPrevious,
  pageNumber,
  resetToFirstPage,
} from "./pagination";

describe("forward paging", () => {
  it("starts on page one with no cursor and nowhere to go back to", () => {
    expect(FIRST_PAGE.cursor).toBeNull();
    expect(hasPrevious(FIRST_PAGE)).toBe(false);
    expect(pageNumber(FIRST_PAGE)).toBe(1);
  });

  it("carries the server's cursor verbatim", () => {
    // Opaque by contract. If this ever transformed the token — trimmed it,
    // re-encoded it, appended anything — the server would reject it, or worse,
    // decode it to an Invalid Date and return a silently empty page.
    const opaque = "eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTI4VDAwOjAwOjAwLjAwMFoiLCJpZCI6ImFiYyJ9";
    const next = goToNext(FIRST_PAGE, opaque);
    expect(next.cursor).toBe(opaque);
  });

  it("walks a sequence without skipping or repeating a page", () => {
    let state = FIRST_PAGE;
    const visited: (string | null)[] = [state.cursor];

    for (const cursor of ["c1", "c2", "c3"]) {
      state = goToNext(state, cursor);
      visited.push(state.cursor);
    }

    expect(visited).toEqual([null, "c1", "c2", "c3"]);
    expect(pageNumber(state)).toBe(4);
    expect(new Set(visited).size).toBe(visited.length);
  });

  it("does not advance past the last page", () => {
    // `nextCursor === null` is the server saying there is nothing after this.
    const state = goToNext(FIRST_PAGE, "c1");
    expect(goToNext(state, null)).toEqual(state);
  });
});

describe("backward paging", () => {
  it("returns to the exact previous page", () => {
    let state = goToNext(FIRST_PAGE, "c1");
    state = goToNext(state, "c2");
    expect(state.cursor).toBe("c2");

    const back = goToPrevious(state);
    expect(back.cursor).toBe("c1");
    expect(pageNumber(back)).toBe(2);
  });

  it("walks all the way back to page one", () => {
    let state = FIRST_PAGE;
    for (const cursor of ["c1", "c2", "c3"]) {
      state = goToNext(state, cursor);
    }
    for (let step = 0; step < 3; step += 1) {
      state = goToPrevious(state);
    }
    expect(state.cursor).toBeNull();
    expect(hasPrevious(state)).toBe(false);
    expect(pageNumber(state)).toBe(1);
  });

  it("is a no-op on page one rather than underflowing the stack", () => {
    expect(goToPrevious(FIRST_PAGE)).toEqual(FIRST_PAGE);
  });

  it("round-trips forward and back to the same state", () => {
    const forward = goToNext(goToNext(FIRST_PAGE, "c1"), "c2");
    const roundTrip = goToNext(goToPrevious(forward), "c2");
    expect(roundTrip).toEqual(forward);
  });
});

describe("resetToFirstPage", () => {
  it("discards the whole walk, not just the current step", () => {
    // Used on `400 invalid_cursor`. Popping one step would hand back another
    // cursor from the same stale sequence, which the server would reject too.
    let state = FIRST_PAGE;
    for (const cursor of ["c1", "c2", "c3"]) {
      state = goToNext(state, cursor);
    }
    const reset = resetToFirstPage();
    expect(reset.cursor).toBeNull();
    expect(reset.history).toEqual([]);
    expect(hasPrevious(reset)).toBe(false);
  });
});
