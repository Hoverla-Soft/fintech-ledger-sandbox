import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, MAX_CURSOR_LENGTH } from "./cursor";

describe("cursor codec", () => {
  it("round-trips a cursor exactly", () => {
    const cursor = { createdAt: new Date("2026-07-27T12:34:56.789Z"), id: "abc-123" };
    const decoded = decodeCursor(encodeCursor(cursor));

    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe("abc-123");
    // Millisecond precision must survive: the repository paginates on
    // (created_at, id), so a truncated timestamp would re-read or skip rows
    // that share a second.
    expect(decoded?.createdAt.toISOString()).toBe("2026-07-27T12:34:56.789Z");
  });

  it("produces a URL-safe token", () => {
    const token = encodeCursor({ createdAt: new Date("2026-07-27T00:00:00.000Z"), id: "a/b+c=d" });

    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
    expect(token).toBe(encodeURIComponent(token));
  });

  it("is opaque — the token is not the raw field values", () => {
    const token = encodeCursor({ createdAt: new Date("2026-07-27T00:00:00.000Z"), id: "txn-42" });
    expect(token).not.toContain("txn-42");
  });

  it("stays well under the length cap for a realistic cursor", () => {
    const token = encodeCursor({
      createdAt: new Date("2026-07-27T12:34:56.789Z"),
      id: "0f9c1e4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
    });
    expect(token.length).toBeLessThan(MAX_CURSOR_LENGTH);
  });

  describe("rejects malformed input by returning null, never throwing", () => {
    // Every one of these is caller-supplied. The router turns null into a
    // 400; a thrown SyntaxError would escape as a 500 for a plainly bad
    // request.
    const malformed: ReadonlyArray<[string, string]> = [
      ["not base64 at all", "!!!!not-base64!!!!"],
      ["valid base64, not JSON", Buffer.from("plain text", "utf8").toString("base64url")],
      ["JSON but not an object", Buffer.from("42", "utf8").toString("base64url")],
      ["JSON null", Buffer.from("null", "utf8").toString("base64url")],
      ["JSON array", Buffer.from("[]", "utf8").toString("base64url")],
      ["missing id", Buffer.from(JSON.stringify({ c: "2026-07-27T00:00:00.000Z" }), "utf8").toString("base64url")],
      ["missing createdAt", Buffer.from(JSON.stringify({ i: "abc" }), "utf8").toString("base64url")],
      ["empty id", Buffer.from(JSON.stringify({ c: "2026-07-27T00:00:00.000Z", i: "" }), "utf8").toString("base64url")],
      ["wrong field types", Buffer.from(JSON.stringify({ c: 1, i: 2 }), "utf8").toString("base64url")],
      ["empty string", ""],
    ];

    it.each(malformed)("returns null for %s", (_label, token) => {
      expect(decodeCursor(token)).toBeNull();
    });

    it("returns null for an unparseable date rather than an Invalid Date", () => {
      // This is the subtle one. `new Date("nonsense")` does not throw — it
      // yields an Invalid Date, which Drizzle would render as SQL NULL,
      // silently matching zero rows and returning an empty page instead of
      // signalling a bad request.
      const token = Buffer.from(JSON.stringify({ c: "nonsense", i: "abc" }), "utf8").toString("base64url");
      const decoded = decodeCursor(token);

      expect(decoded).toBeNull();
    });
  });
});
