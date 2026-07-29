import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  decodeNameCursor,
  decodeTimeCursor,
  encodeCursor,
  encodeNameCursor,
  encodeTimeCursor,
  MAX_CURSOR_LENGTH,
} from "./cursor";

describe("cursor codec", () => {
  it("round-trips a time cursor exactly", () => {
    const cursor = { createdAt: new Date("2026-07-27T12:34:56.789Z"), id: "abc-123" };
    const decoded = decodeTimeCursor(encodeTimeCursor(cursor));

    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe("abc-123");
    // Millisecond precision must survive: the repository paginates on
    // (created_at, id), so a truncated timestamp would re-read or skip rows
    // that share a second.
    expect(decoded?.createdAt.toISOString()).toBe("2026-07-27T12:34:56.789Z");
  });

  it("round-trips a name cursor exactly, including characters that need escaping", () => {
    // Account names are free text up to 120 characters. A name carrying a
    // slash, a quote, or a non-ASCII character has to survive JSON plus
    // base64url untouched, or the walk resumes from the wrong row.
    const cursor = { name: 'Réserve "A"/B — 100%', id: "acct-7" };
    const decoded = decodeNameCursor(encodeNameCursor(cursor));

    expect(decoded).toEqual(cursor);
  });

  it("produces a URL-safe token", () => {
    const token = encodeTimeCursor({
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      id: "a/b+c=d",
    });

    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
    expect(token).toBe(encodeURIComponent(token));
  });

  it("is opaque — the token is not the raw field values", () => {
    const token = encodeTimeCursor({
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      id: "txn-42",
    });
    expect(token).not.toContain("txn-42");
  });

  it("stays well under the length cap for the longest realistic cursor", () => {
    // A name cursor over a maximum-length account name is the worst case, not
    // a timestamp cursor. If `MAX_CURSOR_LENGTH` ever stops covering it, every
    // account page past the first breaks with `invalid_cursor`.
    const token = encodeNameCursor({
      name: "N".repeat(120),
      id: "0f9c1e4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
    });
    expect(token.length).toBeLessThan(MAX_CURSOR_LENGTH);
  });

  describe("rejects malformed input by returning null, never throwing", () => {
    // Every one of these is caller-supplied. The router turns null into a
    // 400; a thrown SyntaxError would escape as a 500 for a plainly bad
    // request.
    const encoded = (payload: string) => Buffer.from(payload, "utf8").toString("base64url");

    const malformed: ReadonlyArray<[string, string]> = [
      ["not base64 at all", "!!!!not-base64!!!!"],
      ["valid base64, not JSON", encoded("plain text")],
      ["JSON but not an object", encoded("42")],
      ["JSON null", encoded("null")],
      ["JSON array", encoded("[]")],
      ["missing id", encoded(JSON.stringify({ k: "2026-07-27T00:00:00.000Z" }))],
      ["missing sort key", encoded(JSON.stringify({ i: "abc" }))],
      ["empty id", encoded(JSON.stringify({ k: "2026-07-27T00:00:00.000Z", i: "" }))],
      ["empty sort key", encoded(JSON.stringify({ k: "", i: "abc" }))],
      ["wrong field types", encoded(JSON.stringify({ k: 1, i: 2 }))],
      ["empty string", ""],
      // The pre-Phase-7a token shape. Cursors are opaque and short-lived, so
      // the rename is not a breaking change — but it must fail loudly as an
      // invalid cursor (which every console screen recovers from by returning
      // to page one with a notice) rather than decode to something wrong.
      ["a legacy {c,i} token", encoded(JSON.stringify({ c: "2026-07-27T00:00:00.000Z", i: "a" }))],
    ];

    it.each(malformed)("returns null for %s", (_label, token) => {
      expect(decodeCursor(token)).toBeNull();
      expect(decodeTimeCursor(token)).toBeNull();
      expect(decodeNameCursor(token)).toBeNull();
    });

    it("returns null for an unparseable date rather than an Invalid Date", () => {
      // This is the subtle one. `new Date("nonsense")` does not throw — it
      // yields an Invalid Date, which Drizzle would render as SQL NULL,
      // silently matching zero rows and returning an empty page instead of
      // signalling a bad request.
      const token = encodeCursor({ key: "nonsense", id: "abc" });

      expect(decodeTimeCursor(token)).toBeNull();
      // The same token is a perfectly valid *name* cursor — "nonsense" is a
      // legal account name. The date check belongs to the time cursor alone,
      // and conflating them would reject legitimate account pages.
      expect(decodeNameCursor(token)).toEqual({ name: "nonsense", id: "abc" });
    });
  });
});
