import type { TransactionCursor } from "@fintech-ledger-sandbox/db/repositories";
import { z } from "zod";

/**
 * Opaque pagination cursors.
 *
 * `packages/db` paginates transactions on the composite `(created_at, id)`
 * index, and its `TransactionCursor` is that position as a structured value.
 * Exposing `{ createdAt, id }` directly on the wire would publish the
 * tiebreaker as API surface: a caller could hand-craft a position, and
 * changing the sort key later would then be a breaking change for every
 * client. Encoding it as one opaque token keeps the ordering an
 * implementation detail — callers may only echo back a cursor the server
 * issued.
 *
 * Base64url, not base64: cursors travel in JSON today but are the kind of
 * value that ends up in a query string, where `+` and `/` need escaping.
 *
 * This is deliberately **not** signed or encrypted. The encoded content is a
 * timestamp and a transaction id the caller just received in the same
 * response, so tampering reveals nothing it did not already have, and every
 * query the cursor feeds is `org_id`-filtered independently — a forged cursor
 * cannot page into another tenant. It buys opacity of the *format*, not
 * confidentiality.
 */

/**
 * Bound on an inbound cursor token, so a malformed page request cannot hand
 * `JSON.parse` an unbounded string. A real cursor is well under 100
 * characters; the ceiling is generous and still finite.
 */
export const MAX_CURSOR_LENGTH = 512;

export const cursorSchema = z.string().min(1).max(MAX_CURSOR_LENGTH);

/** The encoded payload. Short keys because this is a token, not a document. */
interface EncodedCursor {
  /** `createdAt`, ISO-8601. */
  readonly c: string;
  /** `id`. */
  readonly i: string;
}

/** Encodes a repository cursor into an opaque token. */
export function encodeCursor(cursor: TransactionCursor): string {
  const payload: EncodedCursor = { c: cursor.createdAt.toISOString(), i: cursor.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decodes a token back into a repository cursor.
 *
 * Returns `null` for anything malformed — bad base64, invalid JSON, missing
 * or wrong-typed fields, or a date string `Date` cannot parse. Every one of
 * those is caller-supplied input, so the caller gets a `400` from the router;
 * none of them is an exceptional condition worth throwing over, and letting a
 * raw `SyntaxError` escape would surface as a 500 for what is plainly a bad
 * request.
 *
 * The `Number.isNaN(getTime())` check matters: `new Date("nonsense")` yields
 * an Invalid Date rather than throwing, and an Invalid Date passed into a
 * Drizzle `gt(...)` comparison would become `NULL` in SQL, silently matching
 * no rows and returning an empty page instead of an error.
 */
export function decodeCursor(token: string): TransactionCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { c, i } = parsed as Partial<EncodedCursor>;
  if (typeof c !== "string" || typeof i !== "string" || i.length === 0) {
    return null;
  }

  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return { createdAt, id: i };
}
